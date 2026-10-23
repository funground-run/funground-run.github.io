# funground-run.github.io

The sandboxed preview for the funground editor (D-078). The editor at <https://funground-hq.github.io/play/>
runs a learner's sketch in an iframe from this site, which is a different origin, so a sketch from a shared link can
never read or change anything that belongs to the website. This site is a few static files. GitHub Pages serves
them from `main`; there is nothing to build.

| File | What |
|---|---|
| `index.html` | A line saying what this site is, with a link to the editor |
| `preview.html`, `preview.css` | The page the editor puts in its iframe: one canvas, and the guides' box over it (a grid and the mouse's x and y, S-202) |
| `preview.js` | Loads the browser runner from the website, runs the sketches the editor sends, reports back, and registers `sw.js` |
| `sw.js` | The service worker that keeps funground's runtime in the browser, so a repeat visit downloads nothing and Play runs offline (S-210) |

`preview.js` loads the runner (`runner.js`, the worker, the funground wheel) from
`https://funground-hq.github.io/play/runner/`, so the editor and the preview always run the same funground. Pyodide
comes from jsDelivr. The website serves its files with `Access-Control-Allow-Origin: *`.

## Messages

The editor and this page talk only by `postMessage`.

| Direction | Message | Meaning |
|---|---|---|
| editor to preview | `{type: "run", source, filename, files}` | Run this sketch. `files` maps a path to a `Uint8Array` (`{"data/photo.png": bytes}`). A run that arrives while one is starting replaces it |
| editor to preview | `{type: "stop"}` | End the sketch now |
| editor to preview | `{type: "guides", coords, grid}` | Show (`true`) or hide (`false`) the guides over the canvas: `coords` is a label by the pointer with its x and y in the sketch's own pixels, `grid` is lines every 50 pixels with the numbers on the top and left edges (S-202). Sent when the Guides button changes, when the preview is ready, and after each `started`. The overlay takes no mouse. A preview that does not know this message ignores it; an editor that never sends it leaves the page as it was |
| editor to preview | `{type: "snapshot"}` | Save the canvas as it is now as a PNG (`canvas.toBlob`) and send it back as a `file` named `<sketch name>-frame.png` (the last run's file name without `.py`; `picture.png` if the name is empty), with `snapshot: true` (S-212). A preview that does not know this message ignores it |
| editor to preview | `{type: "keep", note}` | Run `f.keep(note)` for the sketch that is running (S-226): it saves the picture, a copy of the code and a record as `studio/001.png`, `studio/001.py` and `studio/001.json` (the next free number) in the sketch's folder, and each one is sent as a `file` message first (without `snapshot`). Then the preview answers `kept`. It keeps the frame on the screen at once, so a script that has finished, or a sketch that called `f.no_loop()`, can be kept; a run that was stopped or has ended with an error cannot. A preview that does not know this message ignores it |
| preview to editor | `{type: "kept", ok, files, base, reason}` | The reply to `keep`. `ok: true`: `files` are the names it wrote (`["studio/001.json", "studio/001.png", "studio/001.py"]`), already sent as `file` messages just before this one, and `base` is the folder path in the preview's Python, for information. `ok: false`: `reason` is a plain sentence ("The sketch is not running, ..."); no file was written. Before the sketch's first frame `files` can be empty (they arrive with the first frame). An editor that never sends `keep` never gets this |
| preview to editor | `{type: "ready", info}` | Python has loaded; `info` is the runner's load report |
| preview to editor | `{type: "output", text, stream}` | `print()` output (`stream` is `"stdout"`) or other messages (`"stderr"`) |
| preview to editor | `{type: "error", text}` | A Python traceback (it is not sent again as `output`) |
| preview to editor | `{type: "started", width, height}` | `setup()` has run: the sketch's size in pixels, so the editor can size the iframe |
| preview to editor | `{type: "finished", reason}` | `"ended"`, `"stopped"` or `"error"`. Sent after `started`. A run that a new `run` replaces sends none: the next `started` is the new run |
| preview to editor | `{type: "file", name, bytes, mime}` | The sketch saved a file (`f.save("poster.png")`; also PDF, SVG and GIF; an MP4 needs ffmpeg, which a browser does not have, so funground's own error says so). `name` is the path in the sketch's folder, `bytes` an `ArrayBuffer` with the whole file (transferred), `mime` its type. A file saved again is sent again. A reply to `snapshot` has `snapshot: true` as well. The preview never starts a download itself: the editor decides (S-212). An older editor ignores this message |
| preview to editor | `{type: "restarting"}` | The last sketch did not stop within a second, so a new Python is loading; the next run waits for it (seconds). An editor that does not know this message can ignore it |
| editor to preview | `{type: "forget"}` | Remove what the preview keeps in this browser: delete the caches whose names start with `funground-` and unregister the service worker (S-210). The sketches are not touched (this site stores none). Answered with `forgotten`. The next visit downloads the runtime again. A preview that does not know this message ignores it |
| preview to editor | `{type: "forgotten"}` | The reply to `forget`: the caches are gone and the service worker is unregistered |
| preview to editor | `{type: "update-ready"}` | A new funground finished downloading in the background (S-210). It starts the next time Python loads (the next visit, or after a restart), not in the run in progress. The editor can say so: "A new funground is ready: it starts the next time you open Play". An editor that does not know this message can ignore it |

The same table is in the README of `funground-hq/funground-hq.github.io`.

**The guides (S-202).** On `guides`, the preview shows `#guides`, a box exactly over the canvas with `pointer-events: none`, so
the sketch keeps all of its mouse. It holds an SVG grid (a thin translucent ink line over a wider pale one, so it reads on white
and on dark pictures) with a line every 50 sketch pixels and the numbers 0, 50, 100... along the top and left edges, and a small
label by the pointer, "x 312, y 140". The numbers are in the sketch's own pixels: the point's place in the canvas's box times the
sketch's size over the box's size (the way the runner maps the mouse). The sketch's size is what `started` reported, not the
canvas's `width` attribute, because on a high-resolution screen the canvas has more backing pixels than the sketch has pixels. The
box is made again when a run starts and when the canvas changes size. The label goes when the pointer leaves the canvas.

- The preview accepts a message only if `event.origin` is the editor's origin and `event.source` is its parent window.
  It posts only to the editor's origin, never to `"*"`.
- The editor shows this page with `sandbox="allow-scripts allow-same-origin"` and `allow="autoplay; microphone"`.
  `allow-same-origin` is needed: without it the page has no origin, and Chrome does not start the runner's worker
  from a `blob:` URL there. The page is still on this site's origin, not the website's.
- Nothing is stored here: no cookies, no local storage, no learner data. The only thing kept is a copy of the runtime (see the next section).

## The runtime stays on the device (S-210)

`preview.js` registers `sw.js` before it starts the runner. It must be this page: the runner's worker is started here, and a
worker started by a page that `sw.js` controls is controlled too (also when it starts from a `blob:` URL, as the runner's does), so
`sw.js` sees what the worker fetches. The website cannot do this: a service worker only sees its own origin's pages. The cache is
kept per top-level site by the browser, so it belongs to the editor that embeds this page.

| What | How it is kept |
|---|---|
| The files `runtime/manifest.json` lists (wheels, fonts) | Cache `funground-runtime-<hash>`, where the hash is the first 16 characters of the SHA-256 of the manifest's bytes. Cache-first. The manifest itself is network-first (the saved copy only offline). Nothing is overwritten: a new manifest gets a new cache |
| Pyodide (jsDelivr) and the PyPI wheels | Cache `funground-vendor`, cache-first: their addresses hold the version. PyPI's list of files (`pypi.org/pypi/<name>/json`) is network-first |
| This page, its script and style, the runner's scripts | Cache `funground-shell`, network-first, so a change is seen at once and the saved copy is used offline |

**An update.** When the manifest's hash is new, this run keeps the old version. `sw.js` downloads the new files in the background into
a new cache: a file whose SHA-256 is in the old cache is copied, not downloaded, and a font nobody used is left for when it is needed. The
manifest goes in last: that marks the cache complete. Then every other `funground-runtime-*` cache is deleted and the editor gets
`update-ready`. The next worker that starts (the next visit, or after a restart) asks for the manifest, gets the new one and uses the new cache.
A cache without a manifest is an update that never finished, and is deleted when `sw.js` starts.

**Fonts.** The runner reads a font lazily: one HEAD for its length, then ranges. `sw.js` answers the HEAD from the manifest (the length, and
`Accept-Ranges: bytes`) with no network, and answers ranges from the saved bytes. It keeps what `fetch` returns, which is already decoded,
and checks its length against the manifest, so a host that compresses a font cannot give Python a font of the wrong length.

**Offline.** After one visit: the preview, the runner, Python, funground and the fonts a sketch used all load and run with no network. Not
available offline: the editor page itself (it comes from the website and is kept only by the browser's own cache), fonts no sketch has used yet,
`load_package` of anything new, and `ON_DEMAND` packages (pygame-ce) not yet used. If the browser cannot run service workers, or
registering fails or takes more than 8 seconds, the runner loads as it did before.

**Remove it.** `{type: "forget"}` makes `sw.js` step aside, deletes every cache starting with `funground-` and unregisters it. The next visit
registers it again.

## Testing on your computer

The editor's test (`tools/test_editor.mjs` in the website repository) serves this folder on `127.0.0.1` and the editor
on `localhost`. By hand, serve both folders on two ports and open
`http://localhost:<editor port>/play/?preview=http://127.0.0.1:<preview port>`.

The editor's address and the runner's folder normally cannot be changed. When this page is served from `localhost` or
`127.0.0.1` only, `preview.html?editor=<origin>&runner=<folder URL>` replaces them. A shared link opens the real
site, where these parameters are ignored.
