/**
 * TMDB controller (thin HTTP glue - no provider logic).
 *   GET /api/tmdb/:id
 *
 * Phase 5 rule respected: TMDB is VISUAL enrichment only. `:id` is the AniList
 * ID (the canonical identity) - never treated as a TMDB ID; TMDB identity is
 * never turned into canonical anime identity. A missing confident match is a
 * 200 with the valid unresolved enrichment representation (never fabricated
 * images).
 */

import { asyncHandler } from '../utils/async-handler.js';
import { parseRequiredId } from '../identity/id-types.js';
import { getAnimeDetails } from '../services/anime.service.js';
import { enrichWithTmdb } from '../services/tmdb.service.js';

/**
 * GET /api/tmdb/:id
 * @type {import('express').RequestHandler}
 */
export const tmdbController = asyncHandler(async (req, res) => {
  const anilistId = parseRequiredId(req.params.id, 'id');
  // AniList-only base (titles for matching; identity untouched).
  const canonical = await getAnimeDetails(anilistId);
  // Visual enrichment result (resolved OR valid unresolved - never a failure
  // response, never fabricated images).
  res.status(200).json(await enrichWithTmdb(canonical));
});
