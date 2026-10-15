// The funground preview page (D-078, S-151 part 2): runs a learner's sketch for the editor and reports back.
//
// The editor (funground-hq.github.io/play/) shows this page in a sandboxed iframe and sends it sketches by
// postMessage. This page is on its own origin, so a sketch from a shared link can reach nothing that belongs to
// the website. It loads the browser runner from the website, so the editor and the preview run the same funground.
// The messages are in README.md. Nothing is stored here: no cookies, no local storage. The service worker (sw.js, S-210)
// keeps funground's runtime in the browser's cache so a repeat visit downloads nothing; "forget" removes it.

// ---- where the editor and the runner are

const REAL = {
  editorOrigin: "https://funground-hq.github.io",
  runnerBase: "https://funground-hq.github.io/play/runner/",
};

// For testing on a computer, `?editor=<origin>&runner=<folder URL>` replaces them. It is accepted ONLY when this
// page itself is served from localhost or 127.0.0.1. A link someone shares points at the real site, where the
// page ignores these parameters, so such a link cannot make the preview talk to, or load code from, another place.
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

function settings() {
  if (!LOCAL_HOSTS.includes(location.hostname)) return REAL;
  const query = new URLSearchParams(location.search);
  return {
    editorOrigin: query.has("editor") ? new URL(query.get("editor")).origin : REAL.editorOrigin,
    runnerBase: query.get("runner") ?? REAL.runnerBase,
  };
}

const { editorOrigin, runnerBase } = settings();

// ---- messages to the editor: always to its origin, never to "*"

function send(message) {
  window.parent.postMessage(message, editorOrigin);
}

// An error is a Python traceback or a syntax error, which names the sketch file and a line.
function isTraceback(text) {
  return text.includes("Traceback") || /File "[^"]+", line \d+/.test(text);
}

function output(text, stream) {
  if (stream === "stderr" && isTraceback(text)) send({ type: "error", text });
  else send({ type: "output", text, stream });
}

// ---- running

const canvas = document.getElementById("canvas");
let runner = null;       // null until Python has loaded
let starting = false;    // a run is between "asked for" and "setup() has run"
let waiting = null;      // the run asked for while one was starting or Python was loading: only the latest is kept
let finishedReason = null;   // how the run ended while it was still starting; sent after "started"
let sketchName = "picture";  // the last run's file name without ".py": the snapshot is called "<it>-frame.png"

function onFinish(reason) {
  if (starting) finishedReason = reason;        // "started" comes first, so the editor sees them in order
  else send({ type: "finished", reason });
}

// Only a well-formed message is run: the editor is trusted, but one bad message must not stop the page working.
function isRun(message) {
  return typeof message.source === "string"
    && typeof message.filename === "string"
    && Object.values(message.files ?? {}).every((bytes) => bytes instanceof Uint8Array);
}

async function run(message) {
  if (!runner || starting) {
    waiting = message;
    return;
  }
  starting = true;
  sketchName = message.filename.replace(/\.py$/, "") || "picture";
  await runner.stop();                          // a run in progress ends first: its end is not the new run's
  finishedReason = null;
  const result = await runner.run(message.source, { filename: message.filename, files: message.files ?? {} });
  starting = false;
  if (result.ok) {
    logical = { width: result.width, height: result.height };
    layoutGuides();                             // a new run may have a new size
    send({ type: "started", width: result.width, height: result.height });
  }
  if (finishedReason) send({ type: "finished", reason: finishedReason });
  if (waiting) {
    const next = waiting;
    waiting = null;
    run(next);
  }
}

function stop() {
  waiting = null;
  runner?.stop();
}

// ---- files the sketch saves (S-212), and the snapshot of the canvas
//
// The runner tells us about each file the sketch writes (f.save("poster.png")). The editor gets it as a message, with the
// bytes transferred, not copied. The editor decides what to do with it: this page never starts a download.

function onFile({ name, bytes, type }) {
  // Copy only if the bytes are a view on part of a larger buffer, so that transferring sends just this file.
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  const buffer = whole ? bytes.buffer : bytes.slice().buffer;
  window.parent.postMessage({ type: "file", name, bytes: buffer, mime: type }, editorOrigin, [buffer]);
}

// "Save picture": the canvas as it is now, as a PNG, sent as a file named after the sketch.
function snapshot() {
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const buffer = await blob.arrayBuffer();
    window.parent.postMessage({ type: "file", name: `${sketchName}-frame.png`, bytes: buffer, mime: "image/png", snapshot: true },
      editorOrigin, [buffer]);
  }, "image/png");
}

// ---- the guides (S-202): a grid every 50 pixels with the numbers on the top and left edges, and the mouse's x and y
//
// Both are in the sketch's own pixels, found the way the runner finds the mouse: the point's place in the canvas's box,
// times the sketch's size over the box's size. That is right at any zoom, at Fit and on a high-resolution screen (where
// the canvas has more backing pixels than the sketch has pixels, so the canvas's width attribute is not the sketch's
// width). The sketch's size is what `started` reported. The box takes no mouse, so the sketch still gets all of it.

const GUIDE_STEP = 50;
const SVG = "http://www.w3.org/2000/svg";
const guideBox = document.getElementById("guides");
const gridLayer = document.createElement("div");
const readout = document.createElement("div");
gridLayer.className = "grid";
readout.className = "readout";
readout.hidden = true;
guideBox.append(gridLayer, readout);
let guides = { coords: false, grid: false };
let logical = null;            // the sketch's size in its own pixels, from the last "started"

function sketchSize() {
  return logical ?? { width: canvas.clientWidth, height: canvas.clientHeight };
}

function svgLine(className, x1, y1, x2, y2) {
  const line = document.createElementNS(SVG, "line");
  line.setAttribute("class", className);
  for (const [name, value] of Object.entries({ x1, y1, x2, y2 })) line.setAttribute(name, value);
  line.setAttribute("vector-effect", "non-scaling-stroke");        // a thin line however the picture is scaled
  return line;
}

function number(text, left, top) {
  const node = document.createElement("span");
  node.className = "number";
  node.textContent = text;
  node.style.left = `${left}%`;
  node.style.top = `${top}%`;
  return node;
}

// Makes the grid again and fits the box to the canvas. Called when the guides change, when a run starts, and when the
// canvas changes size.
function layoutGuides() {
  guideBox.hidden = !(guides.grid || guides.coords);
  if (guideBox.hidden) return;
  const box = canvas.getBoundingClientRect();
  Object.assign(guideBox.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  gridLayer.replaceChildren();
  gridLayer.hidden = !guides.grid;
  readout.hidden = true;
  if (!guides.grid) return;
  const { width, height } = sketchSize();
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  gridLayer.append(svg);
  for (let x = 0; x < width; x += GUIDE_STEP) {
    for (const kind of ["halo", "ink"]) svg.append(svgLine(kind, x, 0, x, height));
    gridLayer.append(number(x, (x / width) * 100, 0));
  }
  for (let y = 0; y < height; y += GUIDE_STEP) {
    for (const kind of ["halo", "ink"]) svg.append(svgLine(kind, 0, y, width, y));
    if (y > 0) gridLayer.append(number(y, 0, (y / height) * 100));        // the corner's 0 is already there
  }
}

function showGuides(message) {
  guides = { coords: message.coords === true, grid: message.grid === true };
  layoutGuides();
}

function moveReadout(event) {
  const box = canvas.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  if (!guides.coords || !inside) {
    readout.hidden = true;
    return;
  }
  const { width, height } = sketchSize();
  const x = Math.round((event.clientX - box.left) * (width / box.width));
  const y = Math.round((event.clientY - box.top) * (height / box.height));
  readout.textContent = `x ${x}, y ${y}`;
  readout.hidden = false;
  // Next to the pointer, on the other side of it near the right and bottom edges.
  const left = event.clientX - box.left + 14;
  const top = event.clientY - box.top + 14;
  readout.style.left = `${left + readout.offsetWidth > box.width ? Math.max(0, left - 28 - readout.offsetWidth) : left}px`;
  readout.style.top = `${top + readout.offsetHeight > box.height ? Math.max(0, top - 28 - readout.offsetHeight) : top}px`;
}

canvas.addEventListener("pointermove", moveReadout);
canvas.addEventListener("pointerleave", () => { readout.hidden = true; });
new ResizeObserver(layoutGuides).observe(canvas);

// The editor gives this frame the focus when the learner presses Run, so the keys go to the sketch, not back to Run.
window.addEventListener("focus", () => canvas.focus());

// ---- messages from the editor: only from its origin, and only from the page that embeds this one

window.addEventListener("message", (event) => {
  if (event.origin !== editorOrigin || event.source !== window.parent) return;
  const message = event.data;
  if (message?.type === "run" && isRun(message)) run(message);
  else if (message?.type === "stop") stop();
  else if (message?.type === "guides") showGuides(message);
  else if (message?.type === "snapshot") snapshot();
  else if (message?.type === "forget") forget();
});

// ---- the service worker (S-210): the runtime stays on the device
//
// This page starts the runner's worker, so this is the page that registers sw.js: a worker started by a controlled page is
// controlled, and its fetches (Pyodide, the wheels, the fonts) pass through sw.js. The runner starts after sw.js is in
// control, so even the first visit's downloads are kept. Without service workers (or if registering fails) nothing changes.

const hasServiceWorker = "serviceWorker" in navigator;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function startServiceWorker() {
  if (!hasServiceWorker) return;
  const control = async () => {
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {               // the first visit: sw.js takes control a moment later
      const taken = new Promise((done) => navigator.serviceWorker.addEventListener("controllerchange", done, { once: true }));
      await Promise.race([taken, sleep(2000)]);
    }
  };
  try {
    await Promise.race([control(), sleep(8000)]);            // a browser that never answers must not stop Python loading
  } catch { /* the runner then loads as it always did */ }
}

// A new funground finished downloading in the background; it starts with the next worker.
if (hasServiceWorker) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "update-ready") send({ type: "update-ready" });
  });
}

// "Remove Play from this browser": sw.js steps aside, every funground cache goes, and it is unregistered. Sketches are not
// stored here, so none is touched. The next visit downloads the runtime and registers again.
async function forget() {
  try {
    const registration = hasServiceWorker ? await navigator.serviceWorker.getRegistration() : null;
    if (registration?.active) {
      const channel = new MessageChannel();
      const answered = new Promise((done) => { channel.port1.onmessage = done; });
      registration.active.postMessage({ type: "forget" }, [channel.port2]);
      await Promise.race([answered, sleep(2000)]);
    }
    for (const name of await caches.keys()) if (name.startsWith("funground-")) await caches.delete(name);
    await registration?.unregister();
  } finally {
    send({ type: "forgotten" });
  }
}

// ---- start: load the runner from the website, then say so

try {
  await startServiceWorker();
  const { createRunner } = await import(new URL("runner.js", runnerBase).href);
  // A sketch that did not stop in time costs a new Python: the editor is told, so a slow next run is not a mystery.
  const onRestart = () => send({ type: "restarting" });
  runner = await createRunner({ canvas, baseUrl: runnerBase, reuse: true, output, onFinish, onRestart, onFile });
  send({ type: "ready", info: runner.info });
  if (waiting) {
    const next = waiting;
    waiting = null;
    run(next);
  }
} catch (error) {
  send({ type: "error", text: `Python did not load: ${error.message ?? error}` });
}
