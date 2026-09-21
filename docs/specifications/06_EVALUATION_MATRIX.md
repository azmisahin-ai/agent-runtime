# 06 — Evaluation Matrix

**Status:** NORMATIVE

## 1. Purpose

Evaluation measures observed execution behavior under controlled task/repository/context/memory/tool/verification conditions. It must not collapse performance into one universal score.

## 2. Fairness contract

```text
SAME TASK
+ SAME REPOSITORY
+ SAME INITIAL STATE
+ SAME TOOLS
+ SAME VERIFICATION
```

EvaluationRun records task, attempt, backend, provider, model, repository revision, runtime configuration, timestamps, outcome and evidence.

## 3. Outcomes

Outcome: SUCCESS, FAILURE, TIMEOUT, CANCELLED, UNKNOWN. Verification: PASS, FAIL, UNKNOWN. UNKNOWN is not PASS. Task success requires completion and required verification PASS.

## 4. Dimensions

Correctness, verification, reliability, efficiency, tool behavior, recovery, context quality, memory utility, latency, resource usage, human intervention and safety.

## 5. Metrics

- success rate
- first-attempt success rate
- eventual success rate
- verification pass rate
- mean/median/p95 latency
- model/context/tool tokens
- tool calls/failures/denials/timeouts
- recovery attempts
- human interventions
- context relevance/duplication ratios
- memory hit/miss/use/rejection/supersession/conflict
- TTFT and time-to-verified-completion
- unauthorized tool attempts and secret exposure attempts

## 6. Dataset

Initial suite: 20 tasks — 5 repository analysis, 5 bug fixes, 5 test fixes, 5 feature tasks. Categories also include refactor, debugging, Git analysis and documentation as the suite expands.

Each task records expected behavior, verification, constraints, repository revision and isolation requirements.

## 7. Reproducibility

Record evaluation ID, task ID, repo revision, backend/model/version, runtime version, context configuration, memory snapshot, tool configuration and verification configuration.

## 8. Failure attribution

Taxonomy: MODEL_FAILURE, BACKEND_FAILURE, CONTEXT_FAILURE, MEMORY_FAILURE, TOOL_FAILURE, VERIFICATION_FAILURE, TIMEOUT, PERMISSION_FAILURE, REPOSITORY_FAILURE, PERSISTENCE_FAILURE, UNKNOWN. Attribution must cite evidence and may identify primary and secondary causes.

## 9. Integrity

Detect test tampering, verification bypass and side effects. Human review can produce PASS/FAIL/UNKNOWN; human opinion is not silently converted into machine evidence.

## 10. Storage

`evaluations`, `evaluation_runs`, `evaluation_events`, `evaluation_metrics`, `evaluation_artifacts`.

## 11. Invariants

Evaluation evidence is immutable; task/repository baseline is explicit; verification is independent; retries remain separate attempts; failure categories are evidence-based; benchmark integrity is protected; no universal score is normative.

## 12. V0.1 implementation

`EvaluationRunner`, `EvaluationSuite`, `EvaluationRecord`, `EvaluationMetrics`, `VerificationRunner`, `FailureClassifier`, `ExperimentRunner`, `RegressionRunner`, `ArtifactStore`, `EvaluationReporter`.
