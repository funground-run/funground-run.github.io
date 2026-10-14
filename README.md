# funground-run.github.io

The sandboxed preview for the funground editor (D-078). The editor at <https://funground-hq.github.io/play/>
runs a learner's sketch in an iframe from this site, which is a different origin, so a sketch from a shared link can
never read or change anything that belongs to the website. This site is a few static files. GitHub Pages serves
them from `main`; there is nothing to build.

| File | What |
|---|---|
| `index.html` | A line saying what this site is, with a link to the editor |
| `preview.html`, `preview.css` | The page the editor puts in its iframe: one canvas, and the guides' box over it (a grid and the mouse's x and y, S-202) |
| `preview.js` | Loads the browser runner from the website, runs the sketches the editor sends, reports back |

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
| preview to editor | `{type: "ready", info}` | Python has loaded; `info` is the runner's load report |
| preview to editor | `{type: "output", text, stream}` | `print()` output (`stream` is `"stdout"`) or other messages (`"stderr"`) |
| preview to editor | `{type: "error", text}` | A Python traceback (it is not sent again as `output`) |
| preview to editor | `{type: "started", width, height}` | `setup()` has run: the sketch's size in pixels, so the editor can size the iframe |
| preview to editor | `{type: "finished", reason}` | `"ended"`, `"stopped"` or `"error"`. Sent after `started`. A run that a new `run` replaces sends none: the next `started` is the new run |
| preview to editor | `{type: "restarting"}` | The last sketch did not stop within a second, so a new Python is loading; the next run waits for it (seconds). An editor that does not know this message can ignore it |

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
- Nothing is stored here: no cookies, no local storage.

## Testing on your computer

The editor's test (`tools/test_editor.mjs` in the website repository) serves this folder on `127.0.0.1` and the editor
on `localhost`. By hand, serve both folders on two ports and open
`http://localhost:<editor port>/play/?preview=http://127.0.0.1:<preview port>`.

The editor's address and the runner's folder normally cannot be changed. When this page is served from `localhost` or
`127.0.0.1` only, `preview.html?editor=<origin>&runner=<folder URL>` replaces them. A shared link opens the real
site, where these parameters are ignored.
