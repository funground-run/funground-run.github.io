// The preview's service worker (S-210): keeps funground's runtime on the learner's device.
//
// The preview page starts the runner's worker, so this worker (registered by preview.js) sees what the runner fetches.
// Three kinds of file, three rules:
//
//   1. The runtime (the files runtime/manifest.json lists: wheels and fonts). The manifest is asked for first, from the
//      network (the saved copy only when offline). The files live in a cache named after the manifest's hash,
//      "funground-runtime-<hash>", and are served cache-first. When the manifest changes, the new version downloads in the
//      background (unchanged files are copied from the old cache, found by SHA-256), the old run keeps its old version, and
//      when the new cache is complete it becomes the one in use for the next worker and every other runtime cache is deleted.
//   2. Pyodide (jsDelivr) and the PyPI wheels: their addresses hold the version, so they are kept in "funground-vendor",
//      cache-first. PyPI's list of files (pypi.org/pypi/<name>/json) changes, so it is network-first.
//   3. The page and the runner's scripts: network-first, and the saved copy when offline.
//
// "Remove Play from this browser" (preview.js) deletes every cache whose name starts with "funground-" and unregisters this worker.

const RUNTIME = "funground-runtime-";
const VENDOR = "funground-vendor";
const SHELL = "funground-shell";
const MANIFEST_END = "/runtime/manifest.json";

let forgotten = false;        // after "forget" this worker steps aside until it is stopped
let current = null;           // the version in use: {cache, files, folder, hash}; null when it must be looked up again
let building = null;          // the hash of the update being downloaded, if any

// The page itself is kept at once, so even the first visit works offline afterwards (it was loaded before this worker ran).
const PAGE_FILES = ["preview.html", "preview.js", "preview.css"];

self.addEventListener("install", (event) => event.waitUntil((async () => {
  await (await caches.open(SHELL)).addAll(PAGE_FILES.map((name) => new URL(name, self.location).href));
  await self.skipWaiting();
})()));

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  await self.clients.claim();
  await deleteOtherRuntimes((await findCurrent())?.name);       // leftovers of an update that never finished
})()));

self.addEventListener("message", (event) => {
  if (event.data?.type === "forget") {
    forgotten = true;
    current = null;
    event.ports[0]?.postMessage("ok");
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (forgotten || request.method !== "GET" && request.method !== "HEAD") return;
  const url = new URL(request.url);
  if (url.pathname.endsWith(MANIFEST_END)) {
    if (request.method === "GET") event.respondWith(serveManifest(event));
  } else if (url.pathname.includes("/runtime/")) {
    event.respondWith(serveRuntimeFile(request, url));
  } else if (url.hostname === "pypi.org") {
    if (request.method === "GET") event.respondWith(networkFirst(request, VENDOR));
  } else if (url.hostname === "cdn.jsdelivr.net" || url.hostname === "files.pythonhosted.org") {
    if (request.method === "GET") event.respondWith(cacheFirst(request, event));
  } else if ((url.origin === location.origin && url.pathname !== "/sw.js") || url.pathname.includes("/play/runner/")) {
    if (request.method === "GET") event.respondWith(networkFirst(request, SHELL));
  }
});

// ---- the runtime

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const jsonResponse = (bytes) => new Response(bytes, { headers: { "Content-Type": "application/json" } });

// The version in use: the newest runtime cache that holds a manifest. (The manifest is put in last, so a cache without
// one is an update that is not finished.)
async function findCurrent() {
  if (current) return current;
  const names = (await caches.keys()).filter((name) => name.startsWith(RUNTIME));
  for (const name of names.reverse()) {
    const cache = await caches.open(name);
    const [entry] = (await cache.keys()).filter((request) => request.url.endsWith(MANIFEST_END));
    if (!entry) continue;
    const manifest = await (await cache.match(entry)).json();
    const files = new Map(manifest.files.map((file) => [new URL(file.name, entry.url).href, file]));
    current = { name, cache, files, manifest, manifestUrl: entry.url, hash: name.slice(RUNTIME.length) };
    return current;
  }
  return null;
}

async function deleteOtherRuntimes(keep) {
  for (const name of await caches.keys()) {
    if (name.startsWith(RUNTIME) && name !== keep) await caches.delete(name);
  }
}

async function serveManifest(event) {
  const url = event.request.url;
  let bytes;
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return response;
    bytes = await response.arrayBuffer();
  } catch {
    const saved = await findCurrent();                                  // offline
    return saved ? jsonResponse(JSON.stringify(saved.manifest)) : Response.error();
  }
  const hash = (await sha256(bytes)).slice(0, 16);
  const inUse = await findCurrent();
  if (inUse?.hash === hash) return jsonResponse(bytes);
  if (!inUse) {                                                         // the first visit: start the cache
    await (await caches.open(RUNTIME + hash)).put(url, jsonResponse(bytes.slice(0)));
    current = null;
    return jsonResponse(bytes);
  }
  if (!building) event.waitUntil(update(inUse, url, bytes, hash));      // an update: this run keeps the old version
  return jsonResponse(JSON.stringify(inUse.manifest));
}

// Downloads a new version into its own cache. The manifest goes in last: that marks the cache complete.
async function update(old, manifestUrl, bytes, hash) {
  building = hash;
  try {
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const cache = await caches.open(RUNTIME + hash);
    const oldBySha = new Map([...old.files].map(([url, file]) => [file.sha256, url]));
    for (const file of manifest.files) {
      const url = new URL(file.name, manifestUrl).href;
      if (await cache.match(url)) continue;                             // an earlier try got this far
      const oldUrl = oldBySha.get(file.sha256);
      const kept = oldUrl && await old.cache.match(oldUrl);
      if (kept) {
        await cache.put(url, kept);                                     // unchanged: copied, not downloaded
        continue;
      }
      const sameName = new URL(file.name, old.manifestUrl).href;
      const neverUsed = old.files.has(sameName) && !(await old.cache.match(sameName));
      if (!neverUsed) await download(cache, url, file);                 // new or changed; a file nobody asked for is fetched when someone does
    }
    await cache.put(manifestUrl, jsonResponse(bytes));
    current = null;
    await deleteOtherRuntimes(RUNTIME + hash);
    for (const client of await self.clients.matchAll()) client.postMessage({ type: "update-ready" });
  } catch {
    // The download failed (offline, or a file is missing): the old version stays and the next visit tries again.
  } finally {
    building = null;
  }
}

async function download(cache, url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const body = await response.arrayBuffer();
  if (body.byteLength !== file.size) throw new Error(`${url}: ${body.byteLength} bytes, the manifest says ${file.size}`);
  await cache.put(url, new Response(body, { headers: { "Content-Type": "application/octet-stream" } }));
}

// A file of the runtime, cache-first. The body is kept as fetch decoded it, with headers of our own, so a font is the same
// length whether or not the host compressed it. The runner reads fonts with ranges (and a HEAD for the length): both are
// answered here, from the manifest and the saved bytes, so a font works offline and the probe never reaches the network.
async function serveRuntimeFile(request, url) {
  const inUse = await findCurrent();
  const file = inUse?.files.get(url.href);
  if (!file) return fetch(request);
  if (request.method === "HEAD") {
    return new Response(null, { headers: { "Content-Length": String(file.size), "Accept-Ranges": "bytes", "Content-Type": "application/octet-stream" } });
  }
  let saved = await inUse.cache.match(url.href);
  if (!saved) {
    try {
      await download(inUse.cache, url.href, file);
    } catch {
      return Response.error();
    }
    saved = await inUse.cache.match(url.href);
  }
  return slice(request, saved);
}

async function slice(request, response) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") ?? "");
  if (!range || (range[1] === "" && range[2] === "")) return response;
  const body = await response.arrayBuffer();
  const start = range[1] === "" ? Math.max(0, body.byteLength - Number(range[2])) : Number(range[1]);
  const end = range[1] === "" || range[2] === "" ? body.byteLength - 1 : Math.min(Number(range[2]), body.byteLength - 1);
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${body.byteLength}` } });
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${start}-${end}/${body.byteLength}` },
  });
}

// ---- Pyodide, PyPI, and the page itself

async function cacheFirst(request, event) {
  const cache = await caches.open(VENDOR);
  const saved = await cache.match(request, { ignoreVary: true });
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) event.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function networkFirst(request, name) {
  const cache = await caches.open(name);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    // The page is asked for with the editor's address in its query; any copy of it will do offline.
    const saved = await cache.match(request, { ignoreVary: true }) ?? await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
    throw error;
  }
}
