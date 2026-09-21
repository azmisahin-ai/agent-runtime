# Agent Runtime — Project Charter

## Mission

Build a model-agnostic coding Agent Runtime / Harness that makes agent execution durable, observable, verifiable and recoverable across local models, API models and external coding agents.

## Core thesis

> The model is not the agent. The agent is not the runtime. The runtime owns continuity.

## Architectural authorities

1. Specifications `01–17` define normative architecture and invariants.
2. `18_IMPLEMENTATION_DELIVERY_ROADMAP.md` defines implementation order.
3. Source code implements the specifications.
4. Tests provide executable proof.
5. Evaluation records observed behavior.
6. `STATUS.md` reports the current implementation boundary.
7. `TRACEABILITY_MATRIX.md` connects requirements to implementation and tests.

## Non-goals

Do not turn this repository into a chat-only wrapper, a model-specific application, an unrestricted shell agent, or an autonomous deployment system.

## Handoff requirement

A new coding agent must be able to clone the repository, read `AGENTS.md`, inspect `STATUS.md`, read the relevant specification and roadmap, run the verification command, and continue from the recorded milestone without relying on private conversation history.
