/**
 * Streaming controllers (thin HTTP glue - no provider logic).
 *   GET /api/stream/resolve/:id  - resolve a playable stream for an anime.
 *
 * CRITICAL: `:id` is the AniList ID (canonical identity). It is NEVER assumed
 * to be a MAL ID - numeric equality means nothing. The AniList -> MAL fallback
 * happens inside the StreamResolver through the IdentityResolver, never here.
 *
 * Query parameters (established contract):
 *   ?episode=1&language=sub  - forwarded to the resolver, which validates them
 *   (positive bounded integer / documented sub|dub values). Unrecognized or
 *   invalid input never reaches the provider.
 */

import { asyncHandler } from '../utils/async-handler.js';
import { parseRequiredId } from '../identity/id-types.js';
import { streamResolver } from '../streaming/stream-resolver.js';

/**
 * GET /api/stream/resolve/:id?episode=1&language=sub
 * @type {import('express').RequestHandler}
 */
export const streamResolveController = asyncHandler(async (req, res) => {
  res.status(200).json(
    await streamResolver.resolveStream({
      anilistId: parseRequiredId(req.params.id, 'id'),
      episode: req.query.episode,
      language: req.query.language,
    }),
  );
});
