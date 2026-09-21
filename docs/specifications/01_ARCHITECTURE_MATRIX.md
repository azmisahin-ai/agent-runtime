# 01 — Architecture Matrix

**Status:** NORMATIVE / architecture reference  
**Scope:** model-agnostic coding Agent Runtime / Harness

## 1. Purpose

This document records the mechanism-level architecture comparison that informed the runtime design. It is not a popularity ranking and does not declare one existing product the canonical implementation. The purpose is to identify mechanisms worth adopting, mechanisms that belong outside the runtime core, and gaps the project must explicitly close.

## 2. Comparison dimensions

| Dimension | OpenHands | Cline | Aider | OpenCode | OpenClaw | ACP/MCP ecosystem | Agent Runtime decision |
|---|---|---|---|---|---|---|---|
| Architecture | autonomous coding runtime | IDE agent | CLI coding loop | terminal coding agent | extensible agent runtime | protocol ecosystem | adopt runtime/backend separation |
| Context | conversation + repo/tool context | workspace + conversation | repo-aware prompts | session/context | persistent agent context | provider-dependent | Context Engine is first-class |
| Memory | session/project mechanisms | task/context continuity | limited durable memory | session-oriented | durable memory patterns | not authoritative | structured Memory Engine |
| Retrieval | repo search/tool retrieval | workspace search | repo map/search | search + tools | tool-driven retrieval | tool/resource dependent | ranked evidence retrieval |
| Compaction | implementation-specific | implementation-specific | context management | session management | persistent context | not core | explicit compaction contract |
| Repository intelligence | repo analysis/tools | workspace intelligence | repo map | search/git | filesystem/tool intelligence | external | indexed evidence graph |
| Tools | sandboxed tool execution | IDE/terminal tools | terminal/git/editor | terminal/editor tools | many integrations | MCP tools/resources | runtime Tool Engine + policy |
| Agent loop | autonomous loop | iterative tool loop | iterative loop | iterative loop | event/tool loop | not defined | Runtime-owned loop |
| State | session/task state | task state | process state | session state | durable state | external | durable Task/Attempt state machine |
| Multi-agent | supported patterns | extensions | limited | ecosystem-dependent | possible | ACP supports agents | later milestone |
| Model abstraction | multiple providers | multiple models | provider abstraction | multiple providers | provider/model adapters | protocol-level | Backend Protocol |
| Persistence | app/project state | workspace/task state | files/git | session/config | durable state | external | SQLite canonical store |
| Evaluation | task execution | user feedback | benchmark/community | tool/task behavior | not core | external | first-class Evaluation Engine |
| Security | sandbox/policy | workspace approvals | shell trust model | permissions | broad integrations | protocol-dependent | explicit trust boundary + default deny |
| UI | web/IDE | IDE | terminal | terminal/TUI | varied | external | UI is a client, not authority |

## 3. Adopted mechanisms

1. Separate model, agent backend, runtime, and UI.
2. Durable task/attempt state independent of model session state.
3. Repository-aware context construction.
4. Tool execution behind schema validation and policy authorization.
5. Checkpoint/resume semantics.
6. Verification independent of agent claims.
7. Recovery as bounded new attempts.
8. Protocol adapters for Ollama, API, CLI, ACP and native agents.
9. Structured observability and append-only execution evidence.
10. Evaluation as a first-class subsystem.

## 4. Explicit non-adoptions / gaps to avoid

- Chat history is not a durable execution model.
- Vector similarity is not authoritative memory truth.
- An external agent session is not the runtime Task state.
- A model response is not proof of success.
- Tool availability does not imply tool authorization.
- A UI session must not become the persistence authority.
- A single universal agent score is not the evaluation model.

## 5. Architectural conclusion

The project combines the strongest relevant mechanisms into a single runtime contract while keeping provider-specific behavior behind adapters. The central design decision is: **the runtime owns continuity**.
