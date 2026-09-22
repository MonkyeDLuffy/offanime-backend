/**
 * Phase 7 endpoint tests: GET /api/home.
 *
 * Uses the real Express app on an ephemeral port with a mocked global fetch
 * routed by provider host. No live AniList/Jikan/TMDB/Supabase required.
 *
 * Covered: successful response, cached response (no extra provider calls),
 * section failure omitted (no destructive empty fallback), total failure +
 * structured error, total failure with stale-if-error fallback.
 */

// Env setup MUST be the first import (ESM evaluates imports depth-first in
// order, so this runs before config/env.js loads).
import './helpers/test-env.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  installApiMocks,
  startTestServer,
  resetL1Cache,
  expireL1Entry,
  anilistMedia,
  anilistPage,
} from './helpers/test-server.js';

const HOME_KEY = 'api:home:v1';

/** @param {string} query */
function anilistKind(query) {
  if (query.includes('airingSchedules')) return 'schedule';
  if (query.includes('recommendations')) return 'recommendations';
  if (query.includes('relations')) return 'relations';
  if (query.includes('Page(') && query.includes('media(')) return 'search';
  if (query.includes('$idMal')) return 'byMal';
  return 'byId';
}

/** AniList handler returning a distinct page per section (by sort variable). */
function sectionHandler({ media, failSorts = [] } = {}) {
  return (body) => {
    if (anilistKind(body.query) !== 'search') throw new Error(`home must only search, got: ${body.query}`);
    const sort = body.variables.sort?.[0] ?? '';
    if (failSorts.includes(sort)) return { status: 500, json: { error: 'boom' } };
    return anilistPage([anilistMedia({ id: 100 + sort.length, idMal: 200 + sort.length, title: `Anime ${sort}` })]);
  };
}

test('GET /api/home -> 200 with populated AniList-backed sections', async () => {
  await resetL1Cache();
  const mock = installApiMocks({ anilist: sectionHandler({}) });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/home`);
    assert.equal(res.status, 200);

    const body = await res.json();
    // Existing contract sections preserved (trending/popular/seasonal/topRated).
    for (const section of ['trending', 'popular', 'seasonal', 'topRated']) {
      assert.ok(Array.isArray(body[section]) && body[section].length > 0, `${section} populated`);
      const card = body[section][0];
      // Canonical identity: id === anilistId, malId separate namespace.
      assert.equal(card.id, card.anilistId);
      assert.equal(typeof card.malId, 'number');
      assert.ok(card.title);
    }

    // Exactly 4 AniList searches (one per section), no Jikan/TMDB/MegaPlay.
    assert.equal(mock.anilistCalls().length, 4);
    assert.equal(mock.jikanCalls().length, 0);
    assert.equal(mock.tmdbCalls().length, 0);
    assert.equal(mock.megaplayCalls().length, 0);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/home -> second request served from cache (zero provider calls)', async () => {
  await resetL1Cache();
  const mock = installApiMocks({ anilist: sectionHandler({}) });
  const server = await startTestServer();
  try {
    const first = await fetch(`${server.baseUrl}/api/home`);
    assert.equal(first.status, 200);
    const callsAfterFirst = mock.calls.length;
    assert.ok(callsAfterFirst > 0);

    const second = await fetch(`${server.baseUrl}/api/home`);
    assert.equal(second.status, 200);
    assert.equal(mock.calls.length, callsAfterFirst);

    const firstBody = await first.json();
    const secondBody = await second.json();
    assert.deepEqual(secondBody, firstBody);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/home -> one failing section is OMITTED, others survive (no destructive empty fallback)', async () => {
  await resetL1Cache();
  const mock = installApiMocks({ anilist: sectionHandler({ failSorts: ['TRENDING_DESC'] }) });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/home`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.trending, undefined);
    assert.ok(Array.isArray(body.popular) && body.popular.length > 0);
    assert.ok(Array.isArray(body.seasonal) && body.seasonal.length > 0);
    assert.ok(Array.isArray(body.topRated) && body.topRated.length > 0);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/home -> ALL sections failing with no cache -> 502 structured error (never [])', async () => {
  await resetL1Cache();
  const mock = installApiMocks({ anilist: () => ({ status: 500, json: { error: 'boom' } }) });
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/api/home`);
    assert.equal(res.status, 502);

    const body = await res.json();
    assert.equal(body.error.code, 'PROVIDER_ERROR');
    assert.ok(body.error.message);
  } finally {
    await server.stop();
    mock.restore();
  }
});

test('GET /api/home -> ALL sections failing with stale cache -> stale fallback served', async () => {
  await resetL1Cache();
  const server = await startTestServer();
  let failing = false;
  const mock = installApiMocks({
    anilist: (body) => {
      if (failing) return { status: 500, json: { error: 'boom' } };
      return sectionHandler({})(body);
    },
  });
  try {
    // Prime the cache with a good response.
    const good = await fetch(`${server.baseUrl}/api/home`);
    assert.equal(good.status, 200);
    const goodBody = await good.json();

    // Expire the L1 entry (retained for stale-if-error), then fail everything.
    expireL1Entry(HOME_KEY);
    failing = true;

    const res = await fetch(`${server.baseUrl}/api/home`);
    assert.equal(res.status, 200);
    const staleBody = await res.json();
    assert.deepEqual(staleBody, goodBody);
  } finally {
    await server.stop();
    mock.restore();
  }
});
