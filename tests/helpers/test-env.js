/**
 * Test env setup. Import this as the FIRST static import of an endpoint test
 * file: ESM evaluates imported modules depth-first in import order, so this
 * module body runs BEFORE any application module (config/env.js) loads.
 */

process.env.LOG_LEVEL = 'error';

// Playback proxy is NOT configured in tests - proxy playback behavior is
// covered with injected fakes (config stays deterministic regardless of a
// local .env file).
process.env.MEGAPLAY_PROXY_URL = '';
