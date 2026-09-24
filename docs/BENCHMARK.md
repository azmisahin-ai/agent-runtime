# Live-model benchmark

`scripts/run-live-benchmark.ts` drives the 20-task initial suite (spec 06) through the
real runtime against a live model server. It is a measurement harness: the runtime
still owns state, verification and success.

## Running it

```bash
npm run build
node dist/scripts/run-live-benchmark.js --model qwen2.5-coder:1.5b
```

Options: `--model`, `--base-url` (default `http://127.0.0.1:11434`), `--out`
(default `$TMPDIR/agent-runtime-benchmark`), `--limit N`.

The harness refuses to run when the model server is not healthy, so a broken
environment cannot be reported as a benchmark result.

## What this run does and does not measure

Each task opens a real attempt against the live model and closes it with a terminal
observation. Verification is a single invariant check,
`runtime-completed-a-real-model-attempt`.

That means the run measures **runtime mechanics and model latency/behaviour**: the
attempt lifecycle, backend initialization, error classification, persistence and
metric recording. It does **not** score whether the task work was performed. The 20
task packs describe bug-fix, test-fix and feature work whose real proof needs the
corresponding task workspace; no such workspace exists in this harness, so the
summary states this scope explicitly rather than presenting a mechanics check as
task success.

A higher-fidelity benchmark would give each task pack its own repository workspace
and per-task verification checks. That is the honest next step for M5, not something
this run claims to have done.

## Recorded results

Run on 2026-09-23, `qwen2.5-coder:1.5b` on CPU (Ollama, 11.2 GiB available):

| Field | Value |
| --- | --- |
| Run count | 20 (5 per category) |
| Wall clock | 301.2 s |
| Mean latency | 15.0 s |
| p95 latency | 34.4 s |
| Outcome distribution | 20 terminal observations, 0 failures |
| Failure categories | `NONE` × 20 |

Per-run latencies ranged from 0.99 s to 45.8 s. `reproducible` was `false` for every
run in this first execution because the seeded workspace was not a git repository, so
no repository revision could be pinned; the harness now initializes a git repository
and commits the seed so subsequent runs record a revision.

Because verification was the mechanics invariant, `success_rate: 1` here means
"every attempt completed against a live model", not "every task was solved". Treat
the numbers as a runtime smoke/latency measurement.

## Honest gaps this run surfaced

- A backend that had never been initialized reported `UNKNOWN` health and failed
  every attempt with `BACKEND_UNAVAILABLE`. Fixed by initializing the backend before
  the first request.
- A backend failure was classified as `UNKNOWN_FAILURE` because classification only
  matched error message text. Fixed by trusting the structured `BackendError.code`.
