// The preview's service worker (S-241, D-150 a).
//
// Its one job is to make the preview page cross-origin isolated, so that the runner can interrupt a sketch that is busy in
// `while True:` and keep its Python (a new Python takes seconds). GitHub Pages cannot send the header that turns isolation on,
// so this worker adds it to the page's own response: `Document-Isolation-Policy: isolate-and-require-corp` (Chrome; a browser
// without it ignores the header and Stop works as before). The header counts from the response after this worker is in
// control, so preview.js reloads the page once on a first visit. `Cross-Origin-Resource-Policy: cross-origin` lets the editor's
// page, which is not isolated, show the preview in its frame.
//
// Only navigations (the page itself) are touched. Every other request is left alone: no respondWith, so it goes to the network
// as if there were no worker. The runtime cache of S-210 made a first visit hang on GitHub Pages (15 Oct 2026), and this worker
// still caches nothing. It also deletes the caches that version made, so a browser that installed it is freed at its next visit.
// The full caching worker is in the history (sw.js at cf7c01c) and comes back with the fix.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith("funground-")) await caches.delete(name);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(isolated(request));
});

async function isolated(request) {
  const response = await fetch(request);
  if (response.status === 0) return response;                        // a redirect the browser follows itself: nothing to add
  const headers = new Headers(response.headers);
  headers.set("Document-Isolation-Policy", "isolate-and-require-corp");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
