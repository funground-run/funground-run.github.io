# funground-run.github.io

The sandboxed preview for the funground editor (D-078). The editor at <https://funground-hq.github.io/play/>
runs a learner's sketch in an iframe from this site, which is a different origin, so a sketch from a shared link can
never read or change anything that belongs to the website. This site is a few static files. GitHub Pages serves
them from `main`; there is nothing to build.

| File | What |
|---|---|
| `index.html` | A line saying what this site is, with a link to the editor |
| `preview.html`, `preview.css` | The page the editor puts in its iframe: one canvas |
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
| preview to editor | `{type: "ready", info}` | Python has loaded; `info` is the runner's load report |
| preview to editor | `{type: "output", text, stream}` | `print()` output (`stream` is `"stdout"`) or other messages (`"stderr"`) |
| preview to editor | `{type: "error", text}` | A Python traceback (it is not sent again as `output`) |
| preview to editor | `{type: "started", width, height}` | `setup()` has run: the sketch's size in pixels, so the editor can size the iframe |
| preview to editor | `{type: "finished", reason}` | `"ended"`, `"stopped"` or `"error"`. Sent after `started` |

The same table is in the README of `funground-hq/funground-hq.github.io`.

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
