// Minimal service worker to satisfy PWA installability criteria.
// JellyTags always needs a live Jellyfin connection, and nginx.conf sets
// Cache-Control: no-cache on index.html/assets/manifest to avoid serving a
// stale build after a redeploy, so this intentionally does not cache
// anything: it just passes every request straight to the network.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // No-op: falls through to default network handling.
});
