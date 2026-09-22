/**
 * TMDB normalizer - converts raw TMDB payloads into stable visual-enrichment
 * shapes. Identity is NEVER established here: these shapes contain only
 * `tmdbId` (a completely separate namespace from AniList/MAL IDs).
 *
 * Image URLs are built ONLY from actual TMDB paths via the centralized helper;
 * missing paths become null (never fabricated, never a disguised poster).
 */

import { normalizeId } from '../identity/id-types.js';
import { tmdbImageUrl } from '../providers/tmdb/tmdb.queries.js';

/** @typedef {import('./tmdb.types.js').TmdbCandidate} TmdbCandidate */
/** @typedef {import('./tmdb.types.js').TmdbVisualResult} TmdbVisualResult */

/** String or null (empty/whitespace-only strings count as missing). */
function str(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Finite number or null. */
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract a year from a TMDB date string ("YYYY-MM-DD" or "YYYY").
 * @param {unknown} value
 * @returns {number | null}
 */
function extractYear(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) && year > 0 ? year : null;
}

/**
 * Normalize a raw TMDB search-result entry (TV or movie) into a candidate.
 * Returns null for unusable entries (missing id) - never fabricates.
 * @param {unknown} raw
 * @param {'tv'|'movie'} [defaultMediaType='tv'] Search endpoints do not set
 *   media_type, so the searched kind is used.
 * @returns {TmdbCandidate | null}
 */
export function normalizeTmdbCandidate(raw, defaultMediaType = 'tv') {
  const tmdbId = normalizeId(raw?.id);
  if (tmdbId === null) return null;
  const mediaType = str(raw?.media_type) ?? defaultMediaType;
  return {
    tmdbId,
    mediaType: mediaType === 'movie' ? 'movie' : 'tv',
    title: str(raw?.name) ?? str(raw?.title),
    originalTitle: str(raw?.original_name) ?? str(raw?.original_title),
    year: extractYear(raw?.first_air_date ?? raw?.release_date),
    popularity: numberOrNull(raw?.popularity),
    images: {
      poster: tmdbImageUrl(raw?.poster_path, 'w500'),
      backdrop: tmdbImageUrl(raw?.backdrop_path, 'original'),
    },
  };
}

/**
 * Normalize an array of raw TMDB search results into candidates, dropping
 * unusable entries.
 * @param {unknown} raw Raw TMDB search payload ({ results: [...] }).
 * @param {'tv'|'movie'} [defaultMediaType='tv']
 * @returns {TmdbCandidate[]}
 */
export function normalizeTmdbCandidates(raw, defaultMediaType = 'tv') {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  return results
    .map((entry) => normalizeTmdbCandidate(entry, defaultMediaType))
    .filter(Boolean);
}

/**
 * Build a resolved visual-enrichment result from a selected candidate.
 * @param {TmdbCandidate} candidate
 * @returns {TmdbVisualResult}
 */
export function normalizeTmdbVisual(candidate) {
  return {
    resolved: true,
    tmdbId: candidate.tmdbId,
    mediaType: candidate.mediaType,
    images: {
      // Both come from the actual TMDB backdrop path - a poster is never
      // turned into a fake backdrop/banner.
      backdrop: candidate.images.backdrop,
      banner: candidate.images.backdrop,
    },
    poster: candidate.images.poster,
    reason: null,
  };
}

/**
 * Build a VALID unresolved visual-enrichment result (no confident match / TMDB
 * unavailable). This is not a provider failure and never fabricates visuals.
 * @param {string} reason
 * @returns {TmdbVisualResult}
 */
export function createUnresolvedTmdbVisual(reason) {
  return {
    resolved: false,
    tmdbId: null,
    mediaType: null,
    images: null,
    poster: null,
    reason: str(reason) ?? 'unresolved',
  };
}

/**
 * Normalize raw TMDB details into a visual result (used when details are
 * fetched for a selected candidate instead of search results).
 * @param {unknown} raw Raw TMDB details payload.
 * @param {'tv'|'movie'} mediaType
 * @returns {TmdbVisualResult | null}
 */
export function normalizeTmdbDetails(raw, mediaType = 'tv') {
  const tmdbId = normalizeId(raw?.id);
  if (tmdbId === null) return null;
  return {
    resolved: true,
    tmdbId,
    mediaType: mediaType === 'movie' ? 'movie' : 'tv',
    images: {
      backdrop: tmdbImageUrl(raw?.backdrop_path, 'original'),
      banner: tmdbImageUrl(raw?.backdrop_path, 'original'),
    },
    poster: tmdbImageUrl(raw?.poster_path, 'w500'),
    reason: null,
  };
}
