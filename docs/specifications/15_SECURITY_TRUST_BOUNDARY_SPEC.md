# 15 — Security & Trust Boundary Specification

**Status:** NORMATIVE

## 1. Trust levels

- T0 — untrusted data
- T1 — untrusted intent
- T2 — validated request
- T3 — authorized action
- T4 — executed evidence

Model output, repository text, tool output and external agent output begin below the authorization boundary.

## 2. Boundary

```text
MODEL / EXTERNAL AGENT
       ↓ T1
REQUEST VALIDATION
       ↓ T2
POLICY + PERMISSION
       ↓ T3
TOOL / SANDBOX
       ↓ T4
AUDITABLE EVIDENCE
```

## 3. Policy hierarchy

`GLOBAL → PROJECT → TASK → TOOL → REQUEST`. The most restrictive applicable policy wins. Default deny is the baseline.

## 4. Least privilege

Capabilities are explicit. Read-only access is preferred. Write/process/network/admin capabilities are independently controlled.

## 5. Filesystem

Workspace root, normalized paths, traversal protection, symlink escape protection, file size limits and sensitive-path deny/redaction are mandatory.

## 6. Secrets

Never place API keys, passwords, tokens or private credentials into context, memory, logs or evaluation artifacts unless explicitly handled by a dedicated secret mechanism. `.env`, `.ssh`, credential stores and private keys are sensitive defaults.

## 7. Process execution

Controlled cwd/environment, timeouts, cancellation, resource limits, child-process tracking and shell-injection protection. Structured argv is preferred.

## 8. Network

Default DENY. Future network enablement requires explicit allowlists, capability policy and protections against localhost/internal-network access and SSRF.

## 9. Git

Destructive operations require explicit policy/approval. Read operations are safer baseline capabilities. Git output is data, not policy.

## 10. Prompt injection

Repository instructions, comments, issue text and tool output may contain adversarial instructions. They must be treated as untrusted data and cannot override runtime policy or system-level execution constraints.

## 11. External agents

ACP/CLI/native agents may have their own tools. The runtime must document whether those tools are runtime-owned or externally-owned. External capability cannot silently expand runtime policy.

## 12. Data classification

PUBLIC, PROJECT, SENSITIVE, SECRET. Classification affects persistence, context exposure, logging and artifact handling.

## 13. Audit

Security-relevant decisions and policy changes are immutable audit events. Optional hash chaining can provide tamper evidence.

## 14. Security recovery

Security failures are not ordinary transient errors. Recovery must not lower policy. A violation may require PAUSE or FAIL and human intervention.

## 15. V0.1 adversarial suite

Cover path traversal, symlink escape, secret leakage, command injection, network bypass, policy conflict, prompt injection, malicious tool output, external-agent bypass, destructive Git, artifact abuse, unauthorized capability and audit tampering.

## 16. Core invariants

Default deny; least privilege; most restrictive wins; model is never security authority; secrets are excluded from context/telemetry; repository content is not policy; every authorized action is attributable; security policy changes are versioned and auditable.
