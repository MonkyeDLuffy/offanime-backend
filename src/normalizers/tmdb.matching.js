/**
 * TMDB matching - deterministic, conservative matching between an already-known
 * anime (trusted AniList/Jikan metadata) and TMDB search candidates.
 *
 * Core rule: TMDB search results are ENRICHMENT CANDIDATES, not identity
 * authority. A candidate is selected only when it confidently matches:
 *
 *   1. Title match is REQUIRED (normalized comparison across candidate title
 *      variants vs. known AniList/Jikan titles). Exact/normalized/alternate
 *      variants all count, with primary-title matches preferred.
 *   2. Year compatibility: when a trusted year is known and the candidate's
 *      year is known, they must be within +/-1 (otherwise rejected).
 *   3. Media type compatibility (tv vs movie).
 *   4. Popularity is ONLY a tie-breaker among equally-ranked candidates -
 *      never identity proof.
 *
 * No aggressive fuzzy matching, no "similar enough" acceptance, no unbounded
 * loops. If no candidate confidently matches, the result is null - the caller
 * reports valid unresolved enrichment. A missing banner is better than a
 * banner belonging to the wrong anime.
 */

/** @typedef {import('./tmdb.types.js').TmdbCandidate} TmdbCandidate */

/**
 * Normalize a title for comparison (NOT for identity - only for matching):
 * trim, case-fold, collapse whitespace, remove harmless punctuation
 * differences. Deliberately NOT aggressive fuzzy matching (no similarity
 * scores, no edit distance) so unrelated anime can never accidentally match.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeTitleForComparison(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/['’`]/g, '') // apostrophe variants are harmless differences
    // Punctuation -> space, PRESERVING unicode letters/digits (CJK titles
    // like ワンパンマン must remain matchable).
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the known-title priority list from trusted metadata (AniList first,
 * then Jikan). Order: AniList userPreferred, English, Romaji, Native; then
 * Jikan English, Japanese, synonyms. Deduplicated, empties removed.
 * @param {{ title?: unknown, enrichment?: unknown }} canonical
 * @returns {string[]}
 */
export function extractKnownTitles(canonical) {
  const title = canonical?.title && typeof canonical.title === 'object' ? canonical.title : {};
  const jikan = canonical?.enrichment?.jikan?.title && typeof canonical.enrichment.jikan.title === 'object'
    ? canonical.enrichment.jikan.title
    : {};

  const candidates = [
    title.userPreferred,
    title.english,
    title.romaji,
    title.native,
    jikan.english,
    jikan.japanese,
    ...(Array.isArray(jikan.synonyms) ? jikan.synonyms : []),
  ];

  const seen = new Set();
  const result = [];
  for (const value of candidates) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    const key = normalizeTitleForComparison(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value.trim());
  }
  return result;
}

/**
 * Select the best-matching TMDB candidate using the conservative strategy.
 *
 * @param {TmdbCandidate[]} candidates
 * @param {object} trusted
 * @param {string[]} trusted.titles Known titles in priority order (from
 *   extractKnownTitles).
 * @param {number|null} [trusted.year] Trusted release year (AniList seasonYear).
 * @param {'tv'|'movie'|null} [trusted.mediaType] Trusted media type when known.
 * @returns {TmdbCandidate | null} The selected candidate, or null when no
 *   candidate confidently matches (never forces a result).
 */
export function selectBestMatch(candidates, { titles, year = null, mediaType = null } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (!Array.isArray(titles) || titles.length === 0) return null;

  const knownNormalized = titles.map((t) => normalizeTitleForComparison(t)).filter(Boolean);
  if (knownNormalized.length === 0) return null;
  const primaryNormalized = knownNormalized[0];

  /** @type {TmdbCandidate | null} */
  let best = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;

    // 1. Title match is REQUIRED (normalized comparison, not fuzzy similarity).
    const candidateTitles = [candidate.title, candidate.originalTitle]
      .map((t) => normalizeTitleForComparison(t))
      .filter(Boolean);
    const matchedIndex = knownNormalized.findIndex((known) => candidateTitles.includes(known));
    if (matchedIndex === -1) continue; // wrong title -> rejected, no acceptance

    // Rank: matching the primary (highest-priority) title beats alternate titles.
    const rank = Math.min(
      ...candidateTitles.map((ct) => {
        const idx = knownNormalized.indexOf(ct);
        return idx === -1 ? Number.POSITIVE_INFINITY : idx;
      }),
    );

    // 2. Year compatibility: known-vs-known years must be within +/-1.
    //    Unknown years on either side do not disqualify (never guessed).
    if (
      year !== null &&
      candidate.year !== null &&
      Math.abs(candidate.year - year) > 1
    ) {
      continue; // wrong-year candidate rejected
    }

    // 3. Media type compatibility.
    if (mediaType && candidate.mediaType && candidate.mediaType !== mediaType) {
      continue;
    }

    // 4. Selection: better title rank wins; popularity is ONLY a tie-breaker
    //    among equally-ranked candidates, never identity proof.
    if (
      best === null ||
      rank < bestRank ||
      (rank === bestRank && (candidate.popularity ?? 0) > (best.popularity ?? 0))
    ) {
      best = candidate;
      bestRank = rank;
    }
  }

  return best;
}
