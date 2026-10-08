# funground-run.github.io

The sandboxed preview runner for the funground editor (D-078). The editor on
https://funground-hq.github.io/play/ runs a learner's sketch in an iframe served from
https://funground-run.github.io, a different origin, so code from a shared link can never read or change
anything belonging to the website. Part of funground 0.2 (epic E-31, story S-151 part 2).

**Process:** follow the `funground-sdlc` skill (`.claude/skills/funground-sdlc/SKILL.md`) in every session.

## Relation to the other repositories

- `funground-hq/funground` (branch `release-0.2-web`): the product; `docs/design/Web_Runner_Note.md` is the
  design this repository implements its part of.
- `funground-hq/funground-web`: the runner code (worker, page API). This repository publishes the runner
  page for previews; it holds no learner data and no secrets.
- `funground-hq/funground-hq.github.io`: the website and the editor that embeds this runner.
- Records specific to this repository use the prefix `RUN-`.

## Rules

- The runner page accepts sketches only by `postMessage` from the editor's origin and answers only to it.
- Nothing is stored here: no cookies, no local storage, no analytics.
- Work on a branch; `main` changes by pull request (it deploys).
