# Architecture Refactor Design

**Date:** 2026-03-10
**Scope:** Project Nexus application boundary cleanup and structural refactor

## Goal

Stabilize the current architecture without rewriting the product. The refactor keeps Vue, Pinia, the domain model, and current infrastructure adapters, but moves orchestration out of `store` and Vue components into explicit application-layer facades and use cases.

## Problems Observed

1. Presentation directly imports infrastructure and global service singletons.
2. `store` owns both UI state and multi-resource business orchestration.
3. `App.vue`, `Sidebar.vue`, and `EditorPane.vue` contain session/bootstrap/security flows that belong to application logic.
4. Several files exceed the repository's own file-size and function-size constraints.
5. Error handling is inconsistent: some paths fail loudly, some warn and continue.

## Non-Goals

- No framework migration.
- No rewrite of domain entities.
- No change to external storage providers.
- No silent fallback paths added just to reduce errors.

## Target Architecture

```text
presentation
  -> stores (UI state only)
  -> composables / container-aware view models
  -> views / components

application
  -> facades (presentation-facing orchestration boundary)
  -> use-cases (single-purpose workflows)
  -> dto/result types
  -> ports

domain
  -> entities / services / shared rules

infrastructure
  -> github / db / storage / security adapters

bootstrap
  -> dependency container
  -> app session initialization
```

## Boundary Rules

1. Vue components must not import `src/infrastructure/*`.
2. Vue components must not import global service singletons such as `cryptoProvider`.
3. Pinia stores must not orchestrate remote/local/history/security workflows directly.
4. Cross-resource workflows must live in `application/use-cases` or `application/facades`.
5. `bootstrap/container.ts` is the only assembly root for concrete implementations.

## Main Refactor Slices

### 1. Bootstrap and Session

Move startup logic out of `App.vue` into `bootstrap/appSession.ts`.

Responsibilities:
- initialize theme/auth/workspace
- schedule stale sync
- trigger background token verification
- expose a small session status model to presentation

### 2. Auth Boundary

Introduce `AuthFacade` to wrap:
- token restore
- token verification
- login/logout
- persisted verification timestamp updates

`useAuthStore` becomes a thin state adapter.

### 3. Workspace Boundary

Introduce `WorkspaceFacade` and dedicated use cases for:
- sync
- file editing
- history
- vault/security
- category/file structural mutations

`useNexusStore` will be split into smaller stores:
- `useWorkspaceStore`
- `useSelectionStore`
- `useSyncStore`

### 4. UI Decomposition

Break large layout components into container + presentational pieces:
- `EditorPane.vue` -> toolbar/content/history/export composables/components
- `Sidebar.vue` -> category tree/actions/vault modal/actions composable

### 5. Sync Core Internal Split

Split `SyncService` by responsibility without changing public behavior first:
- sync-down orchestration
- file push/update
- root index push
- shard coordination
- shard repair

## Error Handling Model

Introduce an application result shape for facade returns:

```ts
export type AppResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; cause?: unknown };
```

Rules:
- domain/use-case code throws only for unexpected programmer errors
- expected workflow failures return explicit `AppResult`
- presentation maps result codes to user-facing messages

## Migration Strategy

### Phase 1

Create the bootstrap/container/session layer and move startup/auth orchestration out of `App.vue`.

### Phase 2

Create facades and split `useNexusStore` so state and orchestration no longer live together.

### Phase 3

Refactor `Sidebar.vue` and `EditorPane.vue` to consume the new presentation/store/facade APIs only.

### Phase 4

Split `SyncService` internals and tighten explicit conflict/error behavior.

## Acceptance Criteria

- No presentation file imports `src/infrastructure/*`.
- No presentation file imports `cryptoProvider` directly.
- `App.vue` no longer owns session bootstrap orchestration.
- `useNexusStore.ts` is reduced to state-only adapters or replaced by smaller stores.
- Each new workflow has focused tests.
- Existing `typecheck` and Vitest suite continue to pass.
