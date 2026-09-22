/**
 * 404 handler for unmatched routes.
 *
 * Runs after all routers. Forwards a NotFoundError to the centralized error
 * handler so every unmatched path gets a consistent JSON error shape (rather
 * than Express's default HTML response).
 */

import { NotFoundError } from '../errors/index.js';

/** @type {import('express').RequestHandler} */
export function notFoundHandler(req, _res, next) {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
}
