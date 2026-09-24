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
observation. Verification now maps every task pack to a check that exercises its
declared `verificationIntent` (`src/evaluation/suite-checks.ts`):

- Analysis packs pass only when the model's answer actually cites a repository
  artifact (a module file, an entry point, a config key, git history).
- Bug-fix and test-fix packs inspect the target source file, so a model that merely
  claims "I fixed it" without changing the file fails.
- Checks that cannot decide return `UNKNOWN`, which is never `PASS`.

The seeded workspace deliberately contains the defects the suite describes (an
off-by-one in `src/math.js`, an unguarded `src/parse.js`, a leaking `src/retry.js`,
an unguarded `src/state.js`), so a passing check means the defect was actually
repaired rather than that the seed was already correct. Each task also gets a clean
workspace first: the harness honours the suite's declared `EPHEMERAL_COPY` isolation
by resetting to the baseline commit before every task.

That means the run measures **runtime mechanics, model latency/behaviour and whether
the answer matches each task's declared intent**. It still does **not** prove a model
solved a real task on an arbitrary repository; the workspace is a fixed synthetic
repository, not a real one.

## The Ollama backend is text-only

`OllamaBackend` sends a chat prompt and reads the text reply; it does not advertise
tools. So a model cannot edit the workspace through this backend, and the file-backed
bug-fix checks will fail for a model that only reasons in prose. That is honest: the
runtime does not grant a model file access it was not given, and a claim is not
evidence. The CLI backend is the path that actually mutates a workspace.

## Recorded results

Live run on 2026-09-23, `qwen2.5-coder:1.5b` on CPU (Ollama, 11.2 GiB available).
That run predates the per-task checks below and used the single mechanics invariant,
so its `success_rate: 1` meant "every attempt completed against a live model". The
mechanics results stand:

| Field | Value |
| --- | --- |
| Run count | 20 (5 per category) |
| Wall clock | 301.2 s |
| Mean latency | 15.0 s |
| p95 latency | 34.4 s |
| Outcome distribution | 20 terminal observations, 0 failures |
| Failure categories | `NONE` × 20 |

Per-run latencies ranged from 0.99 s to 45.8 s. `reproducible` was `false` in that
first execution because the seeded workspace was not a git repository; the harness now
initializes one and commits the seed, so subsequent runs pin a revision.

Because the live model server was not available in the environment that added the
per-task checks, that change is verified by `tests/integration/benchmark-checks.test.ts`
against a real HTTP model server returning fixed text, plus a full harness run against
the same server. The full run scores 11/20 with 9 `VERIFICATION_FAILURE`s: the prose
answer cannot repair the seeded defects, exactly as intended. When Ollama is available
again, run the command above to record a live-model result under the new checks.

## Honest gaps this run surfaced

- A backend that had never been initialized reported `UNKNOWN` health and failed
  every attempt with `BACKEND_UNAVAILABLE`. Fixed by initializing the backend before
  the first request.
- A backend failure was classified as `UNKNOWN_FAILURE` because classification only
  matched error message text. Fixed by trusting the structured `BackendError.code`.
- The first benchmark scored every task with one mechanics invariant, which reported
  `success_rate: 1` regardless of task work. Fixed by per-task intent checks.
- A seed comment ("terminal states may return to RUNNING") tripped the state-race
  check's own regex, passing it without a fix. Fixed by removing the comment and
  requiring an actual guard; caught by running the harness against a fixed-text server.
