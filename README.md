# Agent Runtime

Model-agnostic coding Agent Runtime / Harness.

The runtime owns continuity: task state, persistence, context, memory, tools, verification, recovery, and evaluation. Models and external agents are execution backends, not system authorities.

## Current status

**M0 Foundation — implementation in progress.**

Implemented in this repository:

- TypeScript/Node.js project foundation
- SQLite schema and migration
- Project/Task/Attempt domain model
- Task state machine with terminal-state protection
- Append-only event store
- Project and Task repositories
- Configuration loader with validated defaults
- Unit tests for core lifecycle and persistence contracts

M1 is the next milestone: Ollama backend, baseline Context Engine, read/search tools, verification, checkpoint/resume, and the first end-to-end vertical slice.

## Requirements

- Node.js >= 22.5
- npm

Node 22's built-in `node:sqlite` is used for the M0 persistence layer.

## Commands

```bash
npm install
npm run check
npm run build
npm test
```

## Architecture

```text
UI / API
   |
Application Services
   |
Runtime / Domain
   |
Persistence + Events + Config
   |
Backends / Tools / Repository / Verification
```

The model is never the authority for task state, security policy, tool execution, or success.
