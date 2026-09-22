/**
 * TMDB routes (LIVE since Phase 7).
 *
 *   GET /api/tmdb/:id  -> TMDB visual enrichment (backdrops/banners) for an
 *                         AniList ID. TMDB is visual enrichment ONLY; the id
 *                         is the AniList ID (canonical identity), never a TMDB
 *                         ID. A missing confident match is a 200 with the
 *                         valid unresolved enrichment representation.
 */

import { Router } from 'express';
import { tmdbController } from '../controllers/tmdb.controller.js';

const router = Router();

router.get('/tmdb/:id', tmdbController);

export default router;
