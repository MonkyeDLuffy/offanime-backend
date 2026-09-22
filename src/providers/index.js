/**
 * Provider registry.
 *
 * Single place that instantiates each provider and exposes them by name.
 * Services import providers from here rather than constructing them ad hoc, so
 * wiring stays centralized and easy to mock in tests.
 *
 * Instances are cheap (they only hold a name + base URL), so eager creation is
 * fine and keeps call sites simple.
 */

import { PROVIDERS } from '../config/constants.js';
import { AnilistProvider } from './anilist/anilist.provider.js';
import { JikanProvider } from './jikan/jikan.provider.js';
import { TmdbProvider } from './tmdb/tmdb.provider.js';
import { MegaplayProvider } from './megaplay/megaplay.provider.js';

export const anilistProvider = new AnilistProvider();
export const jikanProvider = new JikanProvider();
export const tmdbProvider = new TmdbProvider();
export const megaplayProvider = new MegaplayProvider();

/** Lookup map keyed by the canonical provider id (see PROVIDERS). */
export const providers = Object.freeze({
  [PROVIDERS.ANILIST]: anilistProvider,
  [PROVIDERS.JIKAN]: jikanProvider,
  [PROVIDERS.TMDB]: tmdbProvider,
  [PROVIDERS.MEGAPLAY]: megaplayProvider,
});

export { BaseProvider } from './base-provider.js';
