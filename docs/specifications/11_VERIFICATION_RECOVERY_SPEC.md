# 11 — Verification & Recovery Specification

**Status:** NORMATIVE

## 1. Verification

Verification independently tests whether an agent claim is true. A final response is not proof.

`VerificationResult`: verification_id, task_id, attempt_id, status, checks, evidence, timestamps.

Status: PASS, FAIL, UNKNOWN. UNKNOWN is neither PASS nor FAIL and cannot establish success.

## 2. Checks

TEST, BUILD, LINT, TYPECHECK, INVARIANT, REPOSITORY and CUSTOM. V0.1 defaults to `allow_unknown=false` for success criteria.

## 3. Evidence hierarchy

Actual test execution > repository state > static inspection > agent assertion.

Verification commands must use Tool Engine rather than bypassing policy with a direct shell path.

## 4. Scope

Verification should target affected files/symbols/tests while retaining regression checks. Test tampering and verification bypass must be detected where possible.

## 5. Recovery boundary

```text
FAILURE
 ↓
CLASSIFY
 ↓
DECIDE
 ↓
RECOVER
 ↓
RETRY / RESUME / SWITCH / PAUSE / FAIL
```

## 6. Failure taxonomy

MODEL_FAILURE, BACKEND_FAILURE, CONTEXT_FAILURE, MEMORY_FAILURE, TOOL_FAILURE, VERIFICATION_FAILURE, TIMEOUT, PERMISSION_FAILURE, REPOSITORY_FAILURE, PERSISTENCE_FAILURE, UNKNOWN_FAILURE.

Attribution must be evidence-based and may contain primary and secondary causes.

## 7. Retry semantics

Retries are bounded by `MAX_RECOVERY_ATTEMPTS` and create new Attempts. A terminal failed Attempt is not restarted in place. Recovery cannot weaken security or grant new capabilities.

## 8. Restart semantics

On process restart: load Task/Attempt/checkpoint → inspect repository/Git → reconcile tool/backend state → rebuild context → resume, pause or fail according to evidence. A tool previously marked RUNNING is UNKNOWN unless completion is independently proven.

## 9. Backend switching

Explicit and audited. New backend capability/context limits must be evaluated before execution continues.

## 10. Human intervention

`WAITING_USER` is a first-class state. Human approval cannot be silently simulated by a model response.

## 11. Events

VerificationStarted, VerificationCheckStarted/Completed, VerificationPassed/Failed/Unknown/Completed, FailureDetected/Classified, RecoveryStarted, RecoveryDecisionMade, AttemptStarted/Completed and BackendSwitch events are persisted.

## 12. Core principle

**The agent may claim completion. The runtime must verify it. Recovery may retry it. Only evidence can establish success.**
