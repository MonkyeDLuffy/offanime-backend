/**
 * Test helper: boots the real Express app on an ephemeral port with a mocked
 * global fetch routed by provider host.
 *
 * Zero-dependency endpoint testing - no live AniList/Jikan/TMDB/Supabase.
 * - Requests to `graphql.anilist.co`   -> routeAnilist(body, call)
 * - Requests to `api.jikan.moe`        -> routeJikan(url, call)
 * - Requests to `api.themoviedb.org`   -> routeTmdb(url, call)
 * - Requests to `megaplay.buzz`        -> routeMegaplay(url, call) (Phase 8)
 * - Anything else                      -> hard failure (unexpected request).
 *
 * Supabase L2 stays unconfigured in tests (empty env vars), so the cache
 * manager runs L1-only - exactly like a serverless cold start.
 *
 * Usage:
 *   const mock = installApiMocks({ anilist, jikan, tmdb });
 *   const server = await startTestServer();
 *   try { ... } finally { await server.stop(); mock.restore(); }
 */

import { cacheManager } from '../../src/cache/cache-manager.js';

/**
 * Parse the AniList GraphQL body from a mock fetch call.
 * @param {{ url: string, init: RequestInit, method: string }} call
 * @returns {{ query: string, variables: Record<string, unknown> }}
 */
export function anilistRequestBody(call) {
  return JSON.parse(String(call.init.body ?? '{}'));
}

/**
 * Start the app on a random free port and return its base URL + a stop fn.
 * @returns {Promise<{ baseUrl: string, stop: () => Promise<void> }>}
 */
export async function startTestServer() {
  const { createApp } = await import('../../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Install a mock fetch routed by provider host. Every registered provider
 * host MUST have a handler; any other request fails the test loudly so no
 * unexpected network call slips through (e.g. accidental MegaPlay usage).
 *
 * @param {object} handlers
 * @param {(body: { query: string, variables: Record<string, unknown> }, call: object) => Promise<Response | object> | Response | object} [handlers.anilist]
 *   Return a real Response or a descriptor { status, json }.
 * @param {(url: string, call: object) => Promise<Response | object> | Response | object} [handlers.jikan]
 * @param {(url: string, call: object) => Promise<Response | object> | Response | object} [handlers.tmdb]
 * @param {(url: string, call: object) => Promise<Response | object> | Response | object} [handlers.megaplay]
 * @returns {{ calls: Array<object>, restore: () => void }}
 */
export function installApiMocks({ anilist, jikan, tmdb, megaplay } = {}) {
  const original = globalThis.fetch;
  /** @type {Array<object>} */
  const calls = [];

  const asResponse = async (result) => {
    if (result instanceof Response) return result;
    if (result && typeof result === 'object' && 'status' in result) {
      const body = result.body !== undefined ? result.body : JSON.stringify(result.json ?? {});
      return new Response(body, {
        status: result.status,
        headers: { 'content-type': result.contentType ?? 'application/json' },
      });
    }
    // Bare object -> a successful JSON response body.
    if (result && typeof result === 'object') {
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('mock handler must return a Response or object');
  };

  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), init, method: init.method ?? 'GET' };
    // Pass through the test's own HTTP requests to the local app server.
    if (call.url.includes('127.0.0.1') || call.url.includes('localhost')) {
      return original(url, init);
    }
    calls.push(call);

    if (call.url.includes('graphql.anilist.co')) {
      if (!anilist) throw new Error(`unexpected AniList request: ${call.url}`);
      return asResponse(await anilist(anilistRequestBody(call), call));
    }
    if (call.url.includes('api.jikan.moe')) {
      if (!jikan) throw new Error(`unexpected Jikan request: ${call.url}`);
      return asResponse(await jikan(call.url, call));
    }
    if (call.url.includes('api.themoviedb.org')) {
      if (!tmdb) throw new Error(`unexpected TMDB request: ${call.url}`);
      return asResponse(await tmdb(call.url, call));
    }
    if (call.url.includes('megaplay')) {
      if (!megaplay) throw new Error(`unexpected MegaPlay request: ${call.url}`);
      return asResponse(await megaplay(call.url, call));
    }
    throw new Error(`unexpected fetch to non-provider host: ${call.url}`);
  };

  return {
    calls,
    /** All AniList calls (parsed bodies included). */
    anilistCalls: () =>
      calls
        .filter((c) => c.url.includes('graphql.anilist.co'))
        .map((c) => ({ ...c, body: anilistRequestBody(c) })),
    /** All Jikan call URLs. */
    jikanCalls: () => calls.filter((c) => c.url.includes('api.jikan.moe')).map((c) => c.url),
    /** All TMDB call URLs. */
    tmdbCalls: () => calls.filter((c) => c.url.includes('api.themoviedb.org')).map((c) => c.url),
    /** All MegaPlay call URLs. */
    megaplayCalls: () => calls.filter((c) => c.url.includes('megaplay')),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Clear the L1 memory cache between tests (module-level shared state). */
export function resetL1Cache() {
  return cacheManager.l1.clear();
}

/**
 * Expire an L1 cache entry WITHOUT deleting it (retained for stale-if-error).
 * Lets endpoint tests exercise the stale path without waiting out real TTLs.
 * @param {string} key
 */
export function expireL1Entry(key) {
  const entry = cacheManager.l1._map.get(key);
  if (!entry) throw new Error(`no L1 cache entry for key: ${key}`);
  cacheManager.l1._map.set(key, {
    ...entry,
    expiresAt: Date.now() - 1000,
  });
}

// --- fixtures -----------------------------------------------------------------

/**
 * Raw AniList Media fixture.
 * @param {{ id?: number, idMal?: number|null, title?: string, bannerImage?: string|null, coverImage?: string|null, format?: string, extra?: object }} [options]
 */
export function anilistMedia({ id = 123, idMal = 456, title = 'Test Anime', bannerImage = null, coverImage = null, format = 'TV', extra = {} } = {}) {
  return {
    id,
    idMal,
    title: { romaji: title, english: `${title} EN`, native: 'テスト', userPreferred: title },
    description: '<p>A <b>test</b> anime & more.</p>',
    coverImage: { extraLarge: coverImage, large: coverImage, medium: coverImage },
    bannerImage,
    type: 'ANIME',
    format,
    status: 'FINISHED',
    episodes: 12,
    duration: 24,
    season: 'WINTER',
    seasonYear: 2023,
    genres: ['Action', 'Adventure'],
    synonyms: [`${title} Alt`],
    startDate: { year: 2023, month: 1, day: 10 },
    endDate: { year: 2023, month: 3, day: 28 },
    averageScore: 85,
    popularity: 100000,
    studios: { nodes: [{ name: 'Test Studio' }] },
    ...extra,
  };
}

/**
 * Raw AniList Page (search/seasonal) fixture.
 * @param {object[]} [media] @param {object} [pageInfo]
 */
export function anilistPage(media = [], pageInfo = { total: media.length, currentPage: 1, lastPage: 1, hasNextPage: false, perPage: 20 }) {
  return { data: { Page: { pageInfo, media } } };
}

/**
 * Raw Jikan anime fixture ({ data: {...} } wrapper).
 * @param {{ malId?: number, title?: string, extra?: object }} [options]
 */
export function jikanAnime({ malId = 456, title = 'Test Anime', extra = {} } = {}) {
  return {
    data: {
      mal_id: malId,
      title,
      title_english: `${title} EN`,
      title_japanese: 'テスト',
      images: { jpg: { image_url: 'https://cdn.jikan.moe/img.jpg', large_image_url: 'https://cdn.jikan.moe/img_l.jpg', small_image_url: 'https://cdn.jikan.moe/img_s.jpg' }, webp: {} },
      synopsis: 'A test synopsis.',
      background: null,
      genres: [{ mal_id: 1, name: 'Action' }],
      studios: [{ mal_id: 5, name: 'Test Studio' }],
      producers: [],
      score: 8.5,
      rank: 100,
      members: 90000,
      favorites: 1000,
      aired: { from: '2023-01-10T00:00:00+00:00', to: '2023-03-28T00:00:00+00:00', prop: { from: { year: 2023, month: 1, day: 10 }, to: { year: 2023, month: 3, day: 28 } }, string: 'Jan 10, 2023 to Mar 28, 2023' },
      season: 'winter',
      year: 2023,
      type: 'TV',
      status: 'Finished Airing',
      episodes: 12,
      duration: '24 min per ep',
      ...extra,
    },
  };
}

/**
 * Raw Jikan episodes HTTP body ({ pagination, data: [...] }).
 * @param {object[]} [episodes] @param {object} [pageInfo]
 */
export function jikanEpisodes(episodes = [], pageInfo = { last_visible_page: 1, has_next_page: false, current_page: 1, items: { count: episodes.length, total: episodes.length, per_page: 100 } }) {
  return { status: 200, json: { pagination: pageInfo, data: episodes } };
}

/**
 * Raw Jikan episode entry.
 * @param {{ malId?: number, number?: number, title?: string }} [options]
 */
export function jikanEpisode({ malId = 456, number = 1, title = 'Episode 1' } = {}) {
  return { mal_id: malId, number, title, title_japanese: '第1話', title_romanji: 'Dai 1 Wa', aired: '2023-01-10T00:00:00+00:00', score: 8, filler: false, recap: false, forum_url: null, url: null };
}

/**
 * Raw TMDB search fixture ({ results: [...] }).
 * @param {object[]} [results]
 */
export function tmdbSearchResults(results = []) {
  return { status: 200, json: { page: 1, results, total_pages: 1, total_results: results.length } };
}

/**
 * Raw TMDB TV candidate.
 * @param {{ id?: number, name?: string, originalName?: string, firstAirDate?: string, backdropPath?: string|null, popularity?: number }} [options]
 */
export function tmdbTvCandidate({ id = 789, name = 'Test Anime', originalName = name, firstAirDate = '2023-01-10', backdropPath = '/backdrop.jpg', popularity = 50 } = {}) {
  return { id, name, original_name: originalName, first_air_date: firstAirDate, backdrop_path: backdropPath, poster_path: '/poster.jpg', popularity };
}
