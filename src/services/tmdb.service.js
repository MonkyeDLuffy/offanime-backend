/**
 * TMDB service - visual enrichment for already-known anime.
 *
 *   Canonical Anime -> TMDB service -> cacheManager.getOrLoad
 *                                          -> TMDB provider (search)
 *                                          -> normalizer + conservative matcher
 *                                          -> visual enrichment result
 *                                          -> mergeTmdbIntoCanonical (caller)
 *
 * Design guarantees:
 *   - Cache stores NORMALIZED enrichment results, never raw API responses.
 *   - Three distinct outcomes that are never conflated:
 *       * Successful enrichment  (resolved: true, confident match)
 *       * Valid unresolved       (searched, no confident match / TMDB not
 *                                 configured / no title available)
 *       * Provider failure       (typed error propagates - NEVER cached as
 *                                 visual data; stale-if-error still applies)
 *   - TMDB is OPTIONAL: when unavailable (not configured) the result is a
 *     valid unresolved enrichment and AniList/Jikan data keeps working. A
 *     TMDB failure never causes destructive fallback.
 *   - Conservative matching (tmdb.matching.js): a candidate is accepted only
 *     when it confidently matches. A missing banner is better than a banner
 *     belonging to the wrong anime.
 *   - Search efficiency: uses already-known titles, searches conservatively
 *     (max 2 title attempts), validates candidates, stops at the first
 *     reliable title that yields a confident match, caches the result.
 *     Serverless-friendly - no unbounded search loops.
 *   - Request coalescing through the existing cache manager.
 *   - No frontend routes activated; internal enrichment capability only.
 */

import { tmdbProvider } from '../providers/index.js';
import { cacheManager } from '../cache/cache-manager.js';
import { CACHE_TTL } from '../config/constants.js';
import { parseRequiredId } from '../identity/id-types.js';
import { ValidationError } from '../errors/index.js';
import {
  createUnresolvedTmdbVisual,
  normalizeTmdbCandidates,
  normalizeTmdbVisual,
} from '../normalizers/tmdb.normalizer.js';
import {
  extractKnownTitles,
  normalizeTitleForComparison,
  selectBestMatch,
} from '../normalizers/tmdb.matching.js';

/** Valid unresolved enrichments get a conservative (shorter) TTL than resolved ones. */
const UNRESOLVED_TTL_SECONDS = CACHE_TTL.MEDIUM;

/** Max TMDB search attempts per enrichment (serverless-friendly, conservative). */
const MAX_SEARCH_ATTEMPTS = 2;

/** A cached value is valid only if it is a real visual-enrichment result. */
const isVisualResult = (value) =>
  Boolean(value && typeof value === 'object' && typeof value.resolved === 'boolean');

/**
 * Enrich a canonical anime with TMDB visuals.
 *
 * Returns an enrichment result ({ resolved, tmdbId, mediaType, images, poster }).
 * Attach it to canonical data with `mergeTmdbIntoCanonical` - only resolved
 * results are merged, so a TMDB failure/unresolved result can never replace
 * existing AniList/Jikan data.
 *
 * @param {import('../normalizers/anime.types.js').CanonicalAnime} canonical
 * @param {object} [deps]
 * @param {import('../providers/tmdb/tmdb.provider.js').TmdbProvider} [deps.provider]
 * @param {import('../cache/cache-manager.js').CacheManager} [deps.cache]
 * @returns {Promise<import('../normalizers/tmdb.types.js').TmdbVisualResult>}
 * @throws {ValidationError} invalid canonical input. @throws {ProviderError|
 *   TimeoutError|RateLimitError} provider failure with no stale cache.
 */
export async function enrichWithTmdb(canonical, { provider = tmdbProvider, cache = cacheManager } = {}) {
  if (!canonical || typeof canonical !== 'object') {
    throw new ValidationError('enrichWithTmdb requires a canonical anime with a valid AniList identity');
  }
  const anilistId = parseRequiredId(canonical.anilistId, 'anilistId');

  const key = `tmdb:visual:anilist:${anilistId}`;
  const result = await cache.getOrLoad(
    key,
    () => resolveTmdbVisual(canonical, { provider }),
    { ttlSeconds: CACHE_TTL.DAY, isValid: isVisualResult },
  );

  // Valid unresolved enrichments get a conservative (shorter) TTL. This
  // overwrite only happens after a successful (or genuinely unresolved)
  // service outcome - never on a provider failure.
  if (!result.resolved) {
    await cache.set(key, result, UNRESOLVED_TTL_SECONDS);
  }

  return result;
}

/**
 * Fresh enrichment resolution (cache miss path).
 * @param {object} canonical
 * @param {{ provider: import('../providers/tmdb/tmdb.provider.js').TmdbProvider }} deps
 * @returns {Promise<import('../normalizers/tmdb.types.js').TmdbVisualResult>}
 */
async function resolveTmdbVisual(canonical, { provider }) {
  // TMDB not configured -> valid unresolved enrichment; AniList/Jikan unaffected.
  if (!provider.isConfigured()) {
    return createUnresolvedTmdbVisual('tmdb_not_configured');
  }

  // Title priority from trusted metadata only (AniList first, then Jikan).
  const titles = extractKnownTitles(canonical);
  if (titles.length === 0) {
    return createUnresolvedTmdbVisual('no_title_available');
  }

  // Media type from trusted format: MOVIE -> movie; TV/TV_SHORT/OVA/ONA/etc.
  // conservatively use tv (validated by the matcher before acceptance).
  const mediaType = canonical.format === 'MOVIE' ? 'movie' : 'tv';

  // Trusted release year for client-side validation only - the year is NOT
  // sent to TMDB search, because small calendar differences between databases
  // would wrongly exclude valid matches.
  const year = canonical.seasonYear ?? null;

  // Conservative search: at most MAX_SEARCH_ATTEMPTS title attempts, stopping
  // at the first reliable title that yields a confident match.
  const attempted = new Set();
  const accumulatedCandidates = [];

  for (const title of titles.slice(0, MAX_SEARCH_ATTEMPTS)) {
    const normalized = normalizeTitleForComparison(title);
    if (!normalized || attempted.has(normalized)) continue;
    attempted.add(normalized);

    const raw = mediaType === 'movie'
      ? await provider.searchMovie(title)
      : await provider.searchTv(title);
    accumulatedCandidates.push(...normalizeTmdbCandidates(raw, mediaType));

    const match = selectBestMatch(accumulatedCandidates, { titles, year, mediaType });
    if (match) {
      return normalizeTmdbVisual(match);
    }
  }

  // No sufficiently confident match exists - do NOT force a result.
  return createUnresolvedTmdbVisual('no_confident_match');
}
