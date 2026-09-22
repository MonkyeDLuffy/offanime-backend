/**
 * TMDB service tests - cache-first enrichment flow:
 *   service -> cacheManager.getOrLoad -> provider -> normalizer + matcher
 *
 * HTTP is mocked; no live TMDB calls. Verifies that normalized enrichment is
 * cached, failures are never cached, stale-if-error works, unresolved results
 * follow explicit cache policy, concurrent requests coalesce, and TMDB
 * failures never replace existing AniList/Jikan canonical data.
 */

process.env.LOG_LEVEL = 'error';

import test from 'node:test';
import assert from 'node:assert/strict';

const { enrichWithTmdb } = await import('../src/services/tmdb.service.js');
const { TmdbProvider } = await import('../src/providers/tmdb/tmdb.provider.js');
const { cacheManager } = await import('../src/cache/cache-manager.js');
const { normalizeAnilistAnime } = await import('../src/normalizers/anime.normalizer.js');
const { installMockFetch, jsonResponse } = await import('./helpers/mock-fetch.js');
const { ProviderError } = await import('../src/errors/index.js');

const canonical = normalizeAnilistAnime({
  id: 123,
  idMal: 456,
  title: { romaji: 'One Punch Man', english: 'One-Punch Man', native: null, userPreferred: 'One Punch Man' },
  format: 'TV',
  seasonYear: 2015,
});

/** Build a configured provider + fresh cache for isolation. */
function buildDeps({ apiKey = 'test-key', timeoutMs } = {}) {
  return {
    provider: new TmdbProvider({ apiKey, timeoutMs }),
    cache: cacheManager, // shared singleton; keys are namespaced per anilistId
  };
}

const searchPayload = (overrides = []) => ({
  page: 1,
  results: [
    {
      id: 789,
      name: 'One Punch Man',
      original_name: 'ワンパンマン',
      first_air_date: '2015-10-04',
      popularity: 250,
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
    },
    ...overrides,
  ],
});

test('enrichWithTmdb returns a RESOLVED visual from a confident match', async () => {
  const mock = installMockFetch(() => jsonResponse(searchPayload()));
  const deps = buildDeps();
  try {
    await cacheManager.invalidate('tmdb:visual:anilist:123');
    const visual = await enrichWithTmdb(canonical, deps);
    assert.equal(visual.resolved, true);
    assert.equal(visual.tmdbId, 789);
    assert.equal(visual.images.banner, 'https://image.tmdb.org/t/p/original/backdrop.jpg');
  } finally {
    mock.restore();
    await cacheManager.invalidate('tmdb:visual:anilist:123');
  }
});

test('cache hit avoids TMDB request; normalized result is cached', async () => {
  const mock = installMockFetch(() => jsonResponse(searchPayload()));
  const deps = buildDeps();
  try {
    await cacheManager.invalidate('tmdb:visual:anilist:123');
    await enrichWithTmdb(canonical, deps);
    await enrichWithTmdb(canonical, deps);
    assert.equal(mock.calls.length, 1); // second call served from cache

    const cached = await cacheManager.get('tmdb:visual:anilist:123');
    assert.equal(cached.tmdbId, 789); // normalized enrichment cached, not raw
    assert.equal('results' in cached, false);
  } finally {
    mock.restore();
    await cacheManager.invalidate('tmdb:visual:anilist:123');
  }
});

test('provider failure is NOT cached; typed error propagates', async () => {
  const mock = installMockFetch(() => jsonResponse({ error: 'boom' }, 500));
  const deps = buildDeps();
  try {
    await cacheManager.invalidate('tmdb:visual:anilist:124');
    await assert.rejects(() => enrichWithTmdb({ ...canonical, anilistId: 124 }, deps), ProviderError);
    assert.equal(await cacheManager.get('tmdb:visual:anilist:124'), null);
  } finally {
    mock.restore();
    await cacheManager.invalidate('tmdb:visual:anilist:124');
  }
});

test('stale-if-error: previous enrichment survives provider failure', async () => {
  const key = 'tmdb:visual:anilist:125';
  await cacheManager.invalidate(key);
  const previous = { resolved: true, tmdbId: 789, mediaType: 'tv', images: { backdrop: 'https://x/b.jpg', banner: 'https://x/b.jpg' }, poster: null, reason: null };
  await cacheManager.set(key, previous, -1); // immediately stale
  const mock = installMockFetch(() => jsonResponse({ error: 'boom' }, 500));
  const deps = buildDeps();
  try {
    const visual = await enrichWithTmdb({ ...canonical, anilistId: 125 }, deps);
    assert.deepEqual(visual, previous); // stale value, NOT an error
  } finally {
    mock.restore();
    await cacheManager.invalidate(key);
  }
});

test('valid unresolved enrichment (no confident match) cached per explicit policy', async () => {
  const mock = installMockFetch(() => jsonResponse({ page: 1, results: [{ id: 999, name: 'Unrelated Show', first_air_date: '1990-01-01' }] }));
  const deps = buildDeps();
  try {
    await cacheManager.invalidate('tmdb:visual:anilist:126');
    const visual = await enrichWithTmdb({ ...canonical, anilistId: 126 }, deps);
    assert.equal(visual.resolved, false); // valid unresolved, NOT a failure
    assert.equal(visual.reason, 'no_confident_match');
    // Unresolved results are cached too (shorter TTL), so repeat lookups avoid searches.
    await enrichWithTmdb({ ...canonical, anilistId: 126 }, deps);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
    await cacheManager.invalidate('tmdb:visual:anilist:126');
  }
});

test('TMDB not configured -> valid unresolved enrichment, AniList data fully intact', async () => {
  const mock = installMockFetch(() => jsonResponse(searchPayload()));
  const deps = buildDeps({ apiKey: '' });
  try {
    await cacheManager.invalidate('tmdb:visual:anilist:127');
    const visual = await enrichWithTmdb({ ...canonical, anilistId: 127 }, deps);
    assert.equal(visual.resolved, false);
    assert.equal(visual.reason, 'tmdb_not_configured');
    assert.equal(mock.calls.length, 0); // no TMDB call attempted
    // Existing canonical data is never replaced by null/empty objects.
    assert.equal(canonical.id, 123);
    assert.equal(canonical.title.userPreferred, 'One Punch Man');
    assert.deepEqual(canonical.images, { poster: null, cover: null, banner: null });
  } finally {
    mock.restore();
    await cacheManager.invalidate('tmdb:visual:anilist:127');
  }
});

test('concurrent identical enrichments coalesce into one TMDB search', async () => {
  const mock = installMockFetch(() => jsonResponse(searchPayload()));
  const deps = buildDeps();
  try {
    await cacheManager.invalidate('tmdb:visual:anilist:123');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => enrichWithTmdb(canonical, deps)),
    );
    assert.equal(mock.calls.length, 1); // 5 callers, 1 search
    for (const visual of results) {
      assert.deepEqual(visual, results[0]);
    }
  } finally {
    mock.restore();
    await cacheManager.invalidate('tmdb:visual:anilist:123');
  }
});

test('enrichment + merge: a TMDB failure never replaces existing canonical data', async () => {
  const mock = installMockFetch(() => jsonResponse({ error: 'boom' }, 500));
  const deps = buildDeps();
  const { mergeTmdbIntoCanonical } = await import('../src/normalizers/anime.merge.js');
  const target = { ...canonical, id: 128, anilistId: 128 }; // id mirrors anilistId
  try {
    await cacheManager.invalidate('tmdb:visual:anilist:128');
    // Provider fails with no stale cache -> typed error propagates; the caller
    // keeps the original canonical data untouched (no destructive fallback).
    let visual = null;
    let failed = false;
    try {
      visual = await enrichWithTmdb(target, deps);
    } catch {
      failed = true;
    }
    assert.equal(failed, true);
    assert.equal(visual, null);
    const merged = mergeTmdbIntoCanonical(target, visual);
    assert.deepEqual(merged.images, canonical.images); // unchanged
    assert.equal(merged.id, 128);
  } finally {
    mock.restore();
    await cacheManager.invalidate('tmdb:visual:anilist:128');
  }
});
