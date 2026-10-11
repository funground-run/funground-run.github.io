// The funground preview page (D-078, S-151 part 2): runs a learner's sketch for the editor and reports back.
//
// The editor (funground-hq.github.io/play/) shows this page in a sandboxed iframe and sends it sketches by
// postMessage. This page is on its own origin, so a sketch from a shared link can reach nothing that belongs to
// the website. It loads the browser runner from the website, so the editor and the preview run the same funground.
// The messages are in README.md. Nothing is stored here: no cookies, no local storage.

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
  finishedReason = null;
  const result = await runner.run(message.source, { filename: message.filename, files: message.files ?? {} });
  starting = false;
  if (result.ok) send({ type: "started", width: result.width, height: result.height });
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

// ---- messages from the editor: only from its origin, and only from the page that embeds this one

window.addEventListener("message", (event) => {
  if (event.origin !== editorOrigin || event.source !== window.parent) return;
  const message = event.data;
  if (message?.type === "run" && isRun(message)) run(message);
  else if (message?.type === "stop") stop();
});

// ---- start: load the runner from the website, then say so

try {
  const { createRunner } = await import(new URL("runner.js", runnerBase).href);
  runner = await createRunner({ canvas, baseUrl: runnerBase, reuse: true, output, onFinish });
  send({ type: "ready", info: runner.info });
  if (waiting) {
    const next = waiting;
    waiting = null;
    run(next);
  }
} catch (error) {
  send({ type: "error", text: `Python did not load: ${error.message ?? error}` });
}
