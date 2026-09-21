# 04 — Context Engine Specification

**Status:** NORMATIVE

## 1. Principle

Context is engineered execution input, not chat history. The engine transforms Task + Repository + Git + Memory + Execution State + Tool State + Observations into a bounded `ContextPack`.

## 2. Responsibilities

Intent analysis, repository retrieval, memory retrieval, Git-aware retrieval, dependency expansion, candidate ranking, context budgeting, assembly, compaction, snapshots, provenance and validation.

The Context Engine does not own canonical memory, repository indexing, task state or tool execution.

## 3. ContextPack

```text
context_id
task_id
attempt_id
created_at
model_context_limit
reserved_output_tokens
system_tokens
tool_schema_tokens
retrieval_budget
sections[]
```

Each section has id, type, content, source, priority, token_cost, relevance, timestamp and provenance.

## 4. Section types and priority

Types: SYSTEM, TASK, STATE, MEMORY, REPOSITORY, FILE, SYMBOL, GIT, TOOL, OBSERVATION, TEST, ERROR, INSTRUCTION.

Priority:
- P0 current task/state
- P1 directly relevant code/failure
- P2 tests/dependencies
- P3 memory/repository orientation
- P4 history

Assembly order: SYSTEM → TASK → CURRENT STATE → CRITICAL ERROR/OBSERVATION → DIRECT CODE → TESTS → DEPENDENCIES → MEMORY → GIT → REPO MAP → optional history.

## 5. Retrieval

Candidate pool combines files, symbols, memories, Git changes, tests, errors, observations and repository structure. Ranking signals include task relevance, semantic/lexical relevance, symbol/dependency relevance, Git/test/memory relevance, recency, scope, confidence and token cost. Diversity is used to avoid near-duplicate context.

Conceptual score:

`score = task + semantic + symbol + dependency + git + test + memory + recency - token_cost`

Weights are configuration, not architecture authority.

## 6. Budget

`retrieval_budget = context_limit - reserved_output - system_tokens - tool_tokens - safety_margin`

The engine must not fill the model context to its absolute maximum. Model/backend capability limits are authoritative constraints for a specific Attempt.

## 7. Compression and compaction

Lossless compression is preferred. Lossy summaries must preserve source, timestamp, result, failure and important values. Compaction preserves current objective/state, decisions, unresolved issues, affected files, latest failures, successful fixes and pending actions. It may drop greetings, duplicates, obsolete hypotheses and superseded memory.

## 8. Snapshots

A snapshot stores context hash, token count, sections and retrieval query. Hashing must use canonical serialization. Resume rebuilds context after checking the current repository; old context is evidence, not blindly reusable execution input.

## 9. Injection boundary

Repository files, tool output and external documents are untrusted data. They cannot override runtime instructions or security policy.

## 10. Metrics

Track retrieval precision/recall, relevant/irrelevant/duplicate token ratio, memory/repository hit rate, tool-result compression ratio, compaction count and context-build latency.

## 11. V0.1 components

`IntentParser`, `RepositoryRetriever`, `MemoryRetriever`, `GitRetriever`, `CandidateMerger`, `Ranker`, `Budgeter`, `Assembler`, `Compactor`, `SnapshotStore`, `ContextValidator`.

## 12. Invariants

Budget cannot exceed effective backend limit; reserved output remains protected; superseded memory is filtered; provenance is retained; compaction preserves critical state; fallback/failure is observable; stale repository index is not treated as current truth; tool outputs are bounded; snapshots are reconstructable; memory is not mutated by retrieval.
