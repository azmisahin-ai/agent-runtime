# 16 — Configuration, Policy & Profile Specification

**Status:** NORMATIVE

## 1. Definitions

- **Configuration:** runtime behavior parameters.
- **Policy:** authorization/security constraints.
- **Profile:** scenario-specific configuration + policy.

Configuration hierarchy: GLOBAL → ENVIRONMENT → PROJECT → TASK → ATTEMPT → REQUEST. Security policy uses the most restrictive applicable rule.

## 2. Sources

Defaults, config files, environment variables, project config, task config, runtime request and selected profile. Model output is never a configuration authority.

## 3. Canonical sections

runtime, backend, context, memory, repository, tools, verification, recovery, evaluation, persistence, security, observability and limits.

## 4. Profiles

Baseline profiles: local/dev, test, paper, shadow, readonly and evaluation. Profiles must not silently grant capabilities.

## 5. Attempt snapshot

Execution-sensitive settings are snapshotted into an immutable `ConfigSnapshot` containing ID, task/attempt IDs, schema version, profile, effective config/policy, backend/model, policy version and config hash.

## 6. Execution-sensitive changes

Model, backend, profile, security policy, tool permissions, context limit, verification/recovery policy, workspace root and network capability changes require PAUSE and/or a new Attempt. Safe observability changes may remain live.

## 7. Resume reconciliation

On restart/resume, effective configuration is compared with the Attempt snapshot. A semantic change cannot be silently applied to an active Attempt.

## 8. Security

Repository configuration cannot override runtime security policy. Secrets in environment/config are redacted from logs and context.

## 9. Audit

Configuration/profile/policy changes generate structured events. Policy versions are immutable references for historical Attempts.

## 10. Invariants

No silent execution-semantic changes; active Attempt snapshot is immutable; policy is more restrictive than configuration; model output cannot change policy; security changes are audited; resume reconciles configuration; secrets are protected.
