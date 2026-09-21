# 17 — Observability, Telemetry & Audit Specification

**Status:** NORMATIVE

## 1. Distinction

`LOG ≠ EVENT ≠ METRIC ≠ TRACE ≠ AUDIT`.

- **Event:** canonical execution history.
- **Log:** diagnostic narrative.
- **Metric:** aggregate measurement.
- **Trace:** timing/causal structure.
- **Audit:** security-sensitive immutable evidence.

## 2. Correlation IDs

Use request_id, project_id, task_id, attempt_id, session_id, event_id, tool_run_id, context_snapshot_id, config_snapshot_id, checkpoint_id, verification_id and evaluation_id where applicable.

## 3. Event categories

TASK, ATTEMPT, STATE, CONTEXT, MEMORY, REPOSITORY, BACKEND, TOOL, VERIFICATION, RECOVERY, CONFIG, SECURITY, EVALUATION, PERSISTENCE and SYSTEM.

## 4. Structured events

Canonical execution history is append-only. State changes and canonical events should be persisted atomically. Events include schema version and sequence number.

## 5. Logs

Structured logs support diagnostics but are not canonical state. Secret redaction is mandatory. Raw hidden reasoning is not an observability requirement and must not be persisted as if it were authoritative evidence.

## 6. Metrics

Track counters, gauges and histograms for task outcomes, latency, tokens, tool behavior, verification, recovery, context quality, memory use, backend health and security events. Avoid uncontrolled high-cardinality labels.

## 7. Traces

Use traces for execution timing and causal relationships; use events for durable history. A trace outage must not erase canonical execution state.

## 8. Audit

Audit records are immutable and tamper-evident where feasible. Sensitive actions, policy decisions, approvals, capability changes and security failures are audited. Optional hash chaining can detect modification.

## 9. Failure timeline

A post-mortem must reconstruct Task → Attempt → Context → Backend → Tool → Verification → Recovery → Evaluation using correlation IDs.

## 10. Telemetry failure

Telemetry degradation is distinct from canonical persistence failure. Diagnostic telemetry may degrade; canonical execution evidence cannot be silently discarded.

## 11. Evaluation integration

Telemetry supplies evidence for latency, tokens, tool calls, context quality, memory behavior, recovery and safety metrics. It must not alter the measured outcome.

## 12. Security dashboard

Expose policy denials, unauthorized attempts, secret-redaction events, sandbox violations and audit anomalies without exposing secret values.

## 13. Adversarial tests

Cover event ordering, duplicate events, secret leakage, telemetry outage, audit tampering, high-cardinality abuse, missing correlation IDs, context snapshot mismatch and canonical-event loss.

## 14. Core principle

Observe what is necessary, persist what is authoritative, measure what is useful, audit what is sensitive, redact what is secret, and never allow observability to become execution authority.
