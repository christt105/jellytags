// Minimal service worker to satisfy PWA installability criteria.
// JellyTags always needs a live Jellyfin connection, and nginx.conf.template
// already handles caching correctly (no-cache on index.html, long-lived
// immutable caching on the hashed asset files), so this intentionally does
// not cache anything itself: it just passes every request to the network.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // No-op: falls through to default network handling.
});
