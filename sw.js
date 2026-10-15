// The preview's service worker, in pass-through mode (15 Oct 2026).
//
// The runtime cache of S-210 made a first visit hang on GitHub Pages (not on the local test server). Until that is
// understood and fixed, this worker caches nothing and answers nothing, so every request goes to the network as before
// S-210. It also deletes the caches an earlier version made, so a browser that installed that version is freed at its
// next visit. The full worker is in the history (sw.js at cf7c01c) and comes back with the fix.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith("funground-")) await caches.delete(name);
  await self.clients.claim();
})()));
