/**
 * TMDB normalized type definitions (JSDoc only - no runtime code).
 *
 * TMDB is an OPTIONAL visual enrichment source. These shapes contain ONLY
 * `tmdbId` - deliberately NO `id`, NO `anilistId`, NO `malId`. A TMDB ID never
 * becomes an AniList ID or MAL ID; identity is never established by TMDB.
 *
 * @typedef {Object} TmdbCandidate
 * @property {number} tmdbId
 * @property {'tv'|'movie'} mediaType
 * @property {string|null} title         Display title (name/title).
 * @property {string|null} originalTitle Original-language title.
 * @property {number|null} year          First-air/release year.
 * @property {number|null} popularity    Tie-breaker signal ONLY - never
 *   identity proof.
 * @property {{ poster: string|null, backdrop: string|null }} images
 */

/**
 * The visual enrichment result produced by the TMDB service.
 *
 * @typedef {Object} TmdbVisualResult
 * @property {boolean} resolved          False = valid unresolved enrichment
 *   (no confident match / TMDB unavailable) - never a provider failure.
 * @property {number|null} tmdbId        Set only when resolved.
 * @property {'tv'|'movie'|null} mediaType
 * @property {{ backdrop: string|null, banner: string|null } | null} images
 *   Backdrop/banner are built ONLY from actual TMDB backdrop paths.
 * @property {string|null} poster        Built only from the actual poster path.
 * @property {string | null} reason      Why unresolved (resolved: null).
 */

export {};
