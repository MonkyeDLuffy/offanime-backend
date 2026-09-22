/**
 * Phase 7 endpoint tests: GET /api/recommendations/:id, GET /api/seasons/:id,
 * GET /api/category/:type, GET /api/schedule, GET /api/tmdb/:id, and the
 * reserved GET /api/stream/resolve/:id (must remain 501 until Phase 8).
 *
 * Uses the real Express app on an ephemeral port with a mocked global fetch
 * routed by provider host. No live providers required.
 */

// Env setup MUST be the first import (ESM evaluates imports depth-first in
// order, so this runs before config/env.js loads). TMDB is configured for this
// file only (each test file is its own process) so visual enrichment tests
// exercise the real TMDB request path.
import './helpers/test-env-tmdb.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  installApiMocks,
  startTestServer,
  resetL1Cache,
  anilistMedia,
  anilistPage,
  tmdbSearchResults,
  tmdbTvCandidate,
} from './helpers/test-server.js';

/** @param {string} query */
function anilistKind(query) {
  if (query.includes('airingSchedules')) return 'schedule';
  if (query.includes('recommendations')) return 'recommendations';
  if (query.includes('relations')) return 'relations';
  if (query.includes('Page(') && query.includes('media(')) return 'search';
  if (query.includes('$idMal')) return 'byMal';
  return 'byId';
}

test('GET /api/recommendations/:id -> 200 normalized AniList recommendations (AniList IDs)', async () => {
  await resetL1Cache();
  const mock = installApiMocks({
    anilist: (body) => {
      if (anilistKind(body.query) !== 'recommendations') {
        throw new Error(`expected recommendations, got: ${body.query}`);
      }
      return {
        data: {
          Media: {
            recommendations: {
              nodes: [
                { rating: 100, mediaRecommendation: anilistMedia({ id: 201, idMal: 301, title: 'Recommended A' }) },
                { rating: 80, mediaRecommendation: anilistMedia({ id: 202, idMal: 302, title: 'Recommended B' }) },
                { rating: 50, mediaRecommendation: null },
              ],
            },
          },
        },
      };
    },
  });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/recommendations/123`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(Array.isArray(body) && body.length === 2);
    // Recommendation IDs stay AniList namespaced - never converted to MAL IDs.
    assert.equal(body[0].id, 201);
    assert.equal(body[0].anilistId, 201);
    assert.equal(body[0].malId, 301);
    assert.equal(body[0].rating, 100);
    assert.ok(body[0].title);

    // No heavy per-recommendation enrichment.
    assert.equal(mock.jikanCalls().length, 0);
    assert.equal(mock.tmdbCalls().length, 0);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/recommendations/:id -> invalid ID -> 400; cached behavior on valid ID', async () => {
  await resetL1Cache();
  const mock = installApiMocks({
    anilist: (body) => {
      if (anilistKind(body.query) !== 'recommendations') throw new Error('unexpected query');
      return { data: { Media: { recommendations: { nodes: [] } } } };
    },
  });
  const server = await startTestServer();
  try {
    const bad = await fetch(`${server.baseUrl}/api/recommendations/abc`);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'VALIDATION_ERROR');
    assert.equal(mock.anilistCalls().length, 0);

    const first = await fetch(`${server.baseUrl}/api/recommendations/123`);
    assert.equal(first.status, 200);
    const callsAfterFirst = mock.calls.length;

    const second = await fetch(`${server.baseUrl}/api/recommendations/123`);
    assert.equal(second.status, 200);
    assert.equal(mock.calls.length, callsAfterFirst);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/seasons/:id -> 200 relations from AniList actual relation data (namespace safety)', async () => {
  await resetL1Cache();
  const mock = installApiMocks({
    anilist: (body) => {
      if (anilistKind(body.query) !== 'relations') throw new Error(`expected relations, got: ${body.query}`);
      return {
        data: {
          Media: {
            relations: {
              nodes: [
                { id: 124, idMal: 457, relationType: 'SEQUEL', type: 'ANIME', format: 'TV', title: { romaji: 'Sequel', english: 'Sequel EN', userPreferred: 'Sequel' }, coverImage: { large: 'https://img.anilist.co/seq.jpg', medium: null } },
                { id: 122, idMal: 455, relationType: 'PREQUEL', type: 'ANIME', format: 'TV', title: { romaji: 'Prequel', english: 'Prequel EN', userPreferred: 'Prequel' }, coverImage: { large: 'https://img.anilist.co/pre.jpg', medium: null } },
                { id: null, relationType: 'SIDE_STORY' },
              ],
            },
          },
        },
      };
    },
  });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/seasons/123`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(Array.isArray(body) && body.length === 2);
    assert.equal(body[0].relationType, 'SEQUEL');
    assert.equal(body[0].id, 124);
    assert.equal(body[0].anilistId, 124);
    assert.equal(body[0].malId, 457);
    // Unusable nodes are dropped (never fabricated).
    assert.ok(!body.some((r) => r.id === null));

    assert.equal(mock.anilistCalls().length, 1);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/seasons/:id -> invalid ID -> 400 ValidationError', async () => {
  await resetL1Cache();
  const mock = installApiMocks({ anilist: () => { throw new Error('must not be called'); } });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/seasons/abc`);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
    assert.equal(mock.anilistCalls().length, 0);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/category/:type -> 200 normalized genre category (AniList filtering)', async () => {
  await resetL1Cache();
  const mock = installApiMocks({
    anilist: (body) => {
      if (anilistKind(body.query) !== 'search') throw new Error(`expected search, got: ${body.query}`);
      return anilistPage([anilistMedia({ id: 41, idMal: 51, title: 'Action Anime' })]);
    },
  });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/category/action`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(Array.isArray(body.results) && body.results.length === 1);
    assert.equal(body.results[0].id, 41);
    assert.equal(body.results[0].anilistId, 41);

    // The genre reached AniList as a validated enum value.
    assert.equal(mock.anilistCalls()[0].body.variables.genre, 'Action');
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/category/:type -> special categories and pagination; invalid category -> 400', async () => {
  await resetL1Cache();
  const mock = installApiMocks({ anilist: () => anilistPage([]) });
  const server = await startTestServer();
  try {
    // Special (non-genre) categories map to validated AniList options.
    const airing = await fetch(`${server.baseUrl}/api/category/airing`);
    assert.equal(airing.status, 200);
    assert.equal(mock.anilistCalls()[0].body.variables.status, 'RELEASING');

    const trending = await fetch(`${server.baseUrl}/api/category/trending`);
    assert.equal(trending.status, 200);
    assert.deepEqual(mock.anilistCalls()[1].body.variables.sort, ['TRENDING_DESC']);

    // Punctuation/separator-insensitive genre matching ('Sci-Fi' aliases).
    const sciFi = await fetch(`${server.baseUrl}/api/category/sci-fi`);
    assert.equal(sciFi.status, 200);
    assert.equal(mock.anilistCalls()[2].body.variables.genre, 'Sci-Fi');

    // Pagination passed through and validated.
    const paged = await fetch(`${server.baseUrl}/api/category/action?page=2&perPage=10`);
    assert.equal(paged.status, 200);
    assert.equal(mock.anilistCalls()[3].body.variables.page, 2);

    // Invalid category values never reach the provider.
    const invalid = await fetch(`${server.baseUrl}/api/category/not-a-category`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'VALIDATION_ERROR');
    assert.equal(mock.anilistCalls().length, 4);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/schedule -> 200 normalized airing schedule (AniList only, cached)', async () => {
  await resetL1Cache();
  const mock = installApiMocks({
    anilist: (body) => {
      if (anilistKind(body.query) !== 'schedule') throw new Error(`expected schedule, got: ${body.query}`);
      return {
        data: {
          Page: {
            pageInfo: { hasNextPage: true },
            airingSchedules: [
              { airingAt: 1700000000, episode: 5, media: { id: 123, idMal: 456, title: { romaji: 'Scheduled', english: null, userPreferred: 'Scheduled' } } },
              { airingAt: null, episode: 6, media: { id: 124, idMal: 457, title: { romaji: 'Bad', english: null, userPreferred: 'Bad' } } },
            ],
          },
        },
      };
    },
  });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/schedule`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(Array.isArray(body.results) && body.results.length === 1);
    assert.equal(body.results[0].airingAt, 1700000000);
    assert.equal(body.results[0].episode, 5);
    // AniList identity preserved on schedule entries.
    assert.equal(body.results[0].anime.id, 123);
    assert.equal(body.results[0].anime.anilistId, 123);
    assert.equal(body.results[0].anime.malId, 456);

    assert.equal(mock.jikanCalls().length, 0);
    assert.equal(mock.tmdbCalls().length, 0);

    // Cached: second request makes zero provider calls.
    const callsAfterFirst = mock.calls.length;
    const second = await fetch(`${server.baseUrl}/api/schedule`);
    assert.equal(second.status, 200);
    assert.equal(mock.calls.length, callsAfterFirst);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/schedule -> provider failure -> 502 structured error (never fabricated times)', async () => {
  await resetL1Cache();
  const mock = installApiMocks({ anilist: () => ({ status: 500, json: { error: 'boom' } }) });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/schedule`);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, 'PROVIDER_ERROR');
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/tmdb/:id -> 200 resolved visual enrichment; AniList identity untouched', async () => {
  await resetL1Cache();
  const mock = installApiMocks({
    anilist: (body) => {
      if (anilistKind(body.query) !== 'byId') throw new Error(`expected byId, got: ${body.query}`);
      return { data: { Media: anilistMedia({ id: 123, idMal: 456 }) } };
    },
    tmdb: (url) => {
      if (!url.includes('/search/tv')) throw new Error(`unexpected TMDB path: ${url}`);
      return tmdbSearchResults([tmdbTvCandidate({ id: 789, name: 'Test Anime', backdropPath: '/backdrop.jpg' })]);
    },
  });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/tmdb/123`);
    assert.equal(res.status, 200);

    const body = await res.json();
    // Visual enrichment result - TMDB identity NEVER becomes canonical identity.
    assert.equal(body.resolved, true);
    assert.equal(body.tmdbId, 789);
    assert.equal(body.mediaType, 'tv');
    // Image URLs built from actual TMDB paths (never fabricated).
    assert.equal(body.images.backdrop, 'https://image.tmdb.org/t/p/original/backdrop.jpg');
    assert.equal(body.images.banner, 'https://image.tmdb.org/t/p/original/backdrop.jpg');

    // The AniList search used titles for matching; the id stays AniList.
    assert.equal(mock.anilistCalls()[0].body.variables.id, 123);
    assert.ok(!mock.tmdbCalls()[0].includes('123'), 'AniList ID never sent to TMDB');
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/tmdb/:id -> unresolved: 200 valid unresolved enrichment (no fake URLs)', async () => {
  await resetL1Cache();
  const mock = installApiMocks({
    anilist: (body) => {
      if (anilistKind(body.query) !== 'byId') throw new Error(`expected byId, got: ${body.query}`);
      return { data: { Media: anilistMedia({ id: 123, idMal: 456 }) } };
    },
    tmdb: () => tmdbSearchResults([]),
  });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/tmdb/123`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.resolved, false);
    assert.equal(body.tmdbId, null);
    assert.equal(body.images, null);
    assert.equal(body.poster, null);
    assert.ok(body.reason);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/tmdb/:id -> TMDB failure -> 502 but canonical data unaffected (cached)', async () => {
  await resetL1Cache();
  const mock = installApiMocks({
    anilist: (body) => {
      if (anilistKind(body.query) !== 'byId') throw new Error(`expected byId, got: ${body.query}`);
      return { data: { Media: anilistMedia({ id: 123, idMal: 456 }) } };
    },
    tmdb: () => ({ status: 500, json: { error: 'boom' } }),
  });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/tmdb/123`);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, 'PROVIDER_ERROR');

    // Canonical AniList data was cached before enrichment: details still work
    // (getFullDetails catches the TMDB failure and skips enrichment).
    const details = await fetch(`${server.baseUrl}/api/details/123`);
    assert.equal(details.status, 200);
    const canonical = await details.json();
    assert.equal(canonical.id, 123);
    assert.equal(canonical.anilistId, 123);
    assert.equal(canonical.malId, 456);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/tmdb/:id -> invalid ID -> 400 ValidationError, no provider request', async () => {
  await resetL1Cache();
  const mock = installApiMocks({
    anilist: () => { throw new Error('must not be called'); },
    tmdb: () => { throw new Error('must not be called'); },
  });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/tmdb/abc`);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
    assert.equal(mock.anilistCalls().length, 0);
    assert.equal(mock.tmdbCalls().length, 0);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/stream/resolve/:id is live in Phase 8 -> invalid id rejected (400) before any provider call', async () => {
  await resetL1Cache();
  const mock = installApiMocks({});
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/stream/resolve/abc`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');

    // No provider calls at all - no MegaPlay, no fabricated stream URLs.
    assert.equal(mock.calls.length, 0);
    assert.equal(mock.megaplayCalls().length, 0);
  } finally {
    await server.stop();
    mock.restore();
  }
});
