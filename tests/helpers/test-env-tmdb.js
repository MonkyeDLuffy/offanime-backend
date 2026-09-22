/**
 * Test env setup with TMDB configured. Import as the FIRST static import of a
 * test file that needs TMDB to be configured (visual enrichment tests).
 */

process.env.LOG_LEVEL = 'error';
process.env.TMDB_API_KEY = 'test-tmdb-key';
