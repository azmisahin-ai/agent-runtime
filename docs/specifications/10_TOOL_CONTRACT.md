# 10 — Tool Contract

**Status:** NORMATIVE

## 1. Security boundary

```text
MODEL/AGENT
 ↓ TOOL REQUEST
SCHEMA VALIDATION
 ↓ POLICY CHECK
PERMISSION CHECK
 ↓ EXECUTION
 ↓ OBSERVATION
 ↓ PERSISTENCE
 ↓ MODEL/AGENT
```

The model proposes; the runtime decides; the tool executes; evidence persists.

## 2. ToolDefinition

Each tool declares name, version, description, input schema, capabilities, permission level and limits.

Capabilities include read_only, filesystem_read, filesystem_write, process_execute, network_access and git_access. Permission levels: READ_ONLY, WORKSPACE_WRITE, PROCESS_EXECUTION, NETWORK_ACCESS, ADMIN. Default deny.

## 3. Tool request/result

Requests contain request_id, task_id, attempt_id, tool name/version, arguments and timestamp. Results contain status, output/error, start/end times and metadata.

## 4. Lifecycle

`REQUESTED → VALIDATING → VALIDATED → AUTHORIZED → RUNNING → SUCCEEDED/FAILED/TIMEOUT`, with explicit denial/cancellation paths.

## 5. Filesystem

Project root is the default boundary. Normalize paths, block traversal, protect symlink escapes, bound file sizes and apply sensitive-path policy. Sensitive defaults include `.env`, `.git/config`, `.ssh/`, credential and private-key material.

## 6. Terminal

`terminal.exec` has controlled cwd, explicit environment, timeout/cancellation, output limits and shell-injection defenses. Structured argv is preferred over shell strings.

## 7. Git

Read operations are enabled earlier than destructive operations. Destructive Git actions require explicit policy and approval boundaries.

## 8. Network

Network is disabled by baseline policy. Any future enablement requires explicit policy/capability authorization and SSRF/internal-address protections.

## 9. Output and secrets

Tool output is sanitized/truncated before model observation. Large artifacts are referenced by artifact IDs. Secrets are redacted and never automatically persisted or injected into context.

## 10. Policy resolution

Global + project + task + tool policy are combined; the most restrictive applicable rule wins. Tool discovery is not authorization; server-side checks remain authoritative.

## 11. V0.1 tools

`read_file`, `write_file`, `list_directory`, `search_files`, `git.status`, `git.diff`, `git.log`, `git.branch`, `terminal.exec`; network remains DENY.

## 12. Invariants

No direct model execution; every tool run is persisted; invalid/unknown tools are rejected; filesystem boundaries cannot be bypassed; sensitive paths are protected; denial is distinct from failure; retries create separate evidence; policy cannot be weakened by model output.

## 13. Adversarial tests

Path traversal, symlink escape, shell injection, secret leakage, oversized output, timeout, cancellation, unauthorized capability, unknown tool, policy conflict and prompt-injection/tool-output injection must be covered.
