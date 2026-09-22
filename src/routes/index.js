/**
 * Route registration.
 *
 * Mounts every feature router under the shared API prefix. Routers are thin:
 * they only map HTTP method + path to a controller (or, for reserved routes,
 * to the `notImplemented` handler). They contain NO provider or business logic.
 *
 * All 15 frontend contract routes are registered here so the public API surface
 * is stable from day one. Only `/api/health` is functional in Phase 1; the rest
 * respond with an honest 501 until their phase lands.
 */

import { Router } from 'express';

import { API_PREFIX } from '../config/constants.js';
import healthRoutes from './health.routes.js';
import homeRoutes from './home.routes.js';
import searchRoutes from './search.routes.js';
import animeRoutes from './anime.routes.js';
import streamingRoutes from './streaming.routes.js';
import jikanRoutes from './jikan.routes.js';
import tmdbRoutes from './tmdb.routes.js';

/**
 * Attach all routers to the app under {@link API_PREFIX}.
 * @param {import('express').Express} app
 */
export function registerRoutes(app) {
  const api = Router();

  api.use(healthRoutes); //    /health
  api.use(homeRoutes); //      /home, /schedule
  api.use(searchRoutes); //    /search, /top-search
  api.use(animeRoutes); //     /details, /smart/details, /episodes, /recommendations, /seasons, /category
  api.use(streamingRoutes); // /stream/resolve
  api.use(jikanRoutes); //     /jikan/*
  api.use(tmdbRoutes); //      /tmdb/:id

  app.use(API_PREFIX, api);
}
