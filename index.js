/**
 * Vercel deployment entrypoint (deployment adapter - contains NO business logic).
 *
 * Vercel's zero-config Express support globs candidate entrypoints in the order
 * `{app,index,server}.*` at the project root, then `{src/index,src/app,src/server}.*`,
 * and selects the first file that exists AND directly imports the `express`
 * package. This file is checked BEFORE `src/app.js`, so Vercel picks this
 * entrypoint instead of the (default-export-less) app factory.
 *
 * The Vercel Node runtime requires the entrypoint module to provide a default
 * export (function), an HTTP-method export, a `fetch` export, or an
 * `app.listen()` call at import time. This file satisfies that contract by
 * default-exporting the built Express app, which the runtime then invokes with
 * real Node req/res (no extra helpers are added because the app exposes
 * `.listen`). All `/api/*` routes are preserved by the framework's catch-all
 * route, which passes the original request path through to the app.
 *
 * The app is built ONCE per isolate via `createApp()` - which never opens a
 * listener - so no multiple servers are started during module import.
 * Environment variables come from the Vercel dashboard (src/config/env.js
 * reads `process.env`; the gitignored `.env` is absent on Vercel).
 */

import express from 'express';
import { createApp } from './src/app.js';

const app = createApp();

export default app;
