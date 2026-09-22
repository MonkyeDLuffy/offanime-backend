/**
 * Jikan (MyAnimeList) provider.
 *
 * Role: SECONDARY metadata/enrichment source. Provides richer MAL/Jikan
 * metadata that later merges into the canonical anime object WITHOUT replacing
 * AniList's primary identity. Talks to the official Jikan v4 REST API via the
 * shared Phase 1 HTTP abstraction - no second HTTP client, no SDK.
 *
 * CRITICAL: Jikan is keyed by MAL IDs. `mal_id` is a MAL ID and must NEVER be
 * treated as an AniList ID. Full AniList <-> MAL resolution is the identity
 * layer's job (a later phase); this provider only exposes Jikan lookups.
 *
 * Design guarantees (same as the AniList provider):
 *   - Stateless, request-scoped; caching/coalescing happen outside providers.
 *   - Every request carries a timeout (shared HTTP client).
 *   - No automatic retries (Jikan rate limits are strict; resilience is the
 *     cache layer's stale-if-error job).
 *   - Failures map onto the typed error taxonomy and are NEVER swallowed,
 *     NEVER cached, NEVER converted into [] for single-anime operations.
 *   - Returns RAW Jikan payloads; normalization lives in src/normalizers.
 */

import { BaseProvider } from '../base-provider.js';
import { config } from '../../config/env.js';
import { PROVIDERS } from '../../config/constants.js';
import { NotFoundError, ProviderError, ValidationError } from '../../errors/index.js';
import { parseRequiredId } from '../../identity/id-types.js';
import { animeEpisodesPath, animeFullPath, animePath, animeSearchPath } from './jikan.queries.js';

/** Jikan caps search results at 25 per page. */
const MAX_SEARCH_LIMIT = 25;

export class JikanProvider extends BaseProvider {
  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs] Overrides the default request timeout.
   */
  constructor({ timeoutMs } = {}) {
    super({ name: PROVIDERS.JIKAN, baseUrl: config.JIKAN_API_URL });
    this._timeoutMs = timeoutMs;
  }

  /**
   * Fetch the RAW anime object from Jikan by MyAnimeList ID.
   * Prefers the richer `/full` endpoint; `full: false` uses the basic one.
   *
   * @param {number|string} malId MyAnimeList ID (NOT an AniList ID).
   * @param {{ full?: boolean }} [options]
   * @returns {Promise<Record<string, unknown>>} Raw Jikan anime object.
   * @throws {ValidationError} invalid MAL ID. @throws {NotFoundError} unknown
   *   anime. @throws {RateLimitError|TimeoutError|ProviderError} accordingly.
   */
  async getAnimeByMalId(malId, { full = true } = {}) {
    const id = parseRequiredId(malId, 'malId');
    const path = full ? animeFullPath(id) : animePath(id);

    let response;
    try {
      response = await this.request(path, this._timeoutOptions());
    } catch (err) {
      // Jikan signals "unknown anime" with HTTP 404 (the shared client throws
      // before parsing the body, so map on the upstream status here).
      if (err instanceof ProviderError && err.details?.upstreamStatus === 404) {
        throw new NotFoundError(`Anime not found on Jikan for MAL ID ${id}`, { cause: err });
      }
      throw err;
    }

    // Jikan wraps payloads: { data: {...}, pagination?: {...} }.
    const payload = response.data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ProviderError('Jikan returned a malformed response', { provider: this.name });
    }
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      throw new ProviderError('Jikan response is missing anime data', { provider: this.name });
    }
    return /** @type {Record<string, unknown>} */ (payload.data);
  }

  /**
   * Search anime on Jikan. Supports q/page/limit (Jikan caps limit at 25).
   *
   * @param {string} query
   * @param {{ page?: number, limit?: number }} [options]
   * @returns {Promise<Record<string, unknown>>} Raw Jikan payload
   *   ({ pagination, data: [...] }).
   */
  /**
   * Fetch the RAW episode list for an anime (episode METADATA only - this
   * project never calls streaming providers or fabricates stream URLs).
   *
   * @param {number|string} malId MyAnimeList ID (NOT an AniList ID).
   * @param {{ page?: number }} [options]
   * @returns {Promise<Record<string, unknown>>} Raw Jikan payload
   *   ({ pagination, data: [...] }).
   */
  async getEpisodeList(malId, { page = 1 } = {}) {
    const id = parseRequiredId(malId, 'malId');
    if (!Number.isInteger(page) || page < 1) {
      throw new ValidationError('Jikan episodes page must be a positive integer', { received: page });
    }

    let response;
    try {
      response = await this.request(animeEpisodesPath(id, page), this._timeoutOptions());
    } catch (err) {
      if (err instanceof ProviderError && err.details?.upstreamStatus === 404) {
        throw new NotFoundError(`No episode list on Jikan for MAL ID ${id}`, { cause: err });
      }
      throw err;
    }

    const payload = response.data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ProviderError('Jikan returned a malformed response', { provider: this.name });
    }
    return /** @type {Record<string, unknown>} */ (payload);
  }

  async searchAnime(query, options = {}) {
    if (typeof query !== 'string') {
      throw new ValidationError('Jikan search requires a string query');
    }
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    this._validatePagination(page, limit);

    let response;
    try {
      response = await this.request(animeSearchPath({ q: query, page, limit }), this._timeoutOptions());
    } catch (err) {
      if (err instanceof ProviderError && err.details?.upstreamStatus === 404) {
        throw new NotFoundError(`No Jikan results for "${query.trim()}"`, { cause: err });
      }
      throw err;
    }

    const payload = response.data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ProviderError('Jikan returned a malformed response', { provider: this.name });
    }
    return /** @type {Record<string, unknown>} */ (payload);
  }

  // --- internals ------------------------------------------------------------

  /**
   * @param {number} page
   * @param {number} limit
   */
  _validatePagination(page, limit) {
    if (!Number.isInteger(page) || page < 1) {
      throw new ValidationError('Jikan search page must be a positive integer', { received: page });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
      throw new ValidationError(`Jikan search limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`, {
        received: limit,
      });
    }
  }

  /** Timeout options when a per-provider override is configured. */
  _timeoutOptions() {
    return this._timeoutMs !== undefined ? { timeoutMs: this._timeoutMs } : {};
  }
}
