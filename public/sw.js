// Minimal service worker to satisfy PWA installability criteria.
// JellyTags always needs a live Jellyfin connection, and the build output's
// JS/CSS bundles are unhashed (see PR #24), so this intentionally does not
// cache anything: it just passes every request straight to the network.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // No-op: falls through to default network handling.
});
