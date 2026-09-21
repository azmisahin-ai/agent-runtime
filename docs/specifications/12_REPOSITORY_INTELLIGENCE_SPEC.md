# 12 — Repository Intelligence Specification

**Status:** NORMATIVE

## 1. Principle

The repository is an evidence graph, not merely a directory of files. The index accelerates retrieval; current workspace state remains authoritative for current truth.

## 2. Responsibilities

Discovery, file inventory, symbols, imports/exports, dependency graph, test discovery, configuration discovery, Git state, changed files/symbols, evidence, search and freshness.

Repository Intelligence does not execute or mutate the repository.

## 3. Records

FileRecord tracks normalized path, language, size, hashes and timestamps. SymbolRecord tracks kind, qualified name, location, signature and hash. Symbol identity is project + file + kind + qualified name.

Symbol kinds include Function, Class, Method, Interface, Type, Enum, Constant, Variable and Module.

## 4. Dependency graph

Edges include IMPORTS, EXPORTS, REFERENCES, CALLS, EXTENDS, IMPLEMENTS, USES_TYPE and TESTS. Reverse dependencies are supported. Cycles are represented, not treated as fatal indexing errors.

## 5. Tests/configuration

TestRecord links tests to files/symbols where possible. Configuration files are indexed as evidence, but repository content never overrides runtime security policy.

## 6. Search

Path, filename, lexical text and symbol search are combined into ranked results. Dependency expansion is bounded to prevent context explosion.

## 7. Git integration

Capture branch, HEAD, status, diff, changed files, recent commits and changed symbols. `recently changed = relevant` is not assumed; Git signals are ranking inputs.

## 8. Freshness

Index state: FRESH, STALE, BUILDING, FAILED, UNKNOWN. A stale index is historical evidence, not current truth. Incremental reindexing is preferred; full reindex is available as fallback.

## 9. Evidence

Repository evidence stores revision/content hash/timestamp. Evidence is immutable. Current filesystem/Git state generally outranks stale indexes and stale memory for current repository truth.

## 10. V0.1 storage

`repository_files`, `repository_symbols`, `repository_edges`, `repository_tests`, `repository_evidence`, `repository_index_state`.

## 11. Components

RepositoryScanner, FileIndexer, SymbolIndexer, DependencyIndexer, TestIndexer, ConfigIndexer, GitInspector, RepositorySearch, SymbolSearch, DependencyGraph, RepositoryMap, IndexStore, IndexConsistencyChecker, IndexFreshnessTracker, AffectedScopeAnalyzer, RepositoryReconciler, WorkspaceLock.

## 12. Security and concurrency

Project root is a hard boundary. Repository content is untrusted data. V0.1 recommends one active writer per workspace with a workspace lock and explicit reconciliation after external changes.

## 13. Context integration

Context Engine retrieves files/symbols/tests/dependencies according to task intent. Verification uses affected scope and repository evidence. Memory may reference repository evidence but does not replace it.
