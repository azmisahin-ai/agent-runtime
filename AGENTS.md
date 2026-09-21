# Agent Runtime — Agent Handoff

## Authority

The repository follows the approved specification set and `18_IMPLEMENTATION_DELIVERY_ROADMAP.md`.
The runtime owns continuity, persistence, state, tool authorization, verification, and recovery.

## Current state

- Milestone: **M0 Foundation**
- Live trading / autonomous deployment: out of scope
- Network access: denied by baseline policy
- Next milestone: **M1 First Vertical Slice**

## Before changing code

1. Read `STATUS.md`.
2. Read the relevant specification in `docs/specifications/` and the roadmap.
3. Run `npm run check`.
4. Preserve state-machine, persistence, security, and verification invariants.

## Rules

- Do not make the model the authority for task state or success.
- `UNKNOWN` is never `SUCCESS`.
- A retry creates a new Attempt.
- Terminal Task states cannot silently return to RUNNING.
- Tool execution must remain behind the runtime policy boundary.
- Canonical execution evidence must be persisted.
- Do not add network access to M0/M1 by default.

## Handoff format

Update `STATUS.md` when a milestone or significant implementation boundary changes. Record what was implemented, what remains, verification commands/results, and the exact next action.
