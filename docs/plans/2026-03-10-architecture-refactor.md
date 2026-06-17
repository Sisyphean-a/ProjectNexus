# Architecture Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Project Nexus so presentation, store, and orchestration boundaries match the intended clean architecture without changing product behavior.

**Architecture:** Keep the existing domain model and infrastructure adapters, but introduce a bootstrap/container layer plus application facades and focused use cases. Migrate in phases: first bootstrap and auth/session orchestration, then workspace/store boundaries, then large UI components, then sync-core internals.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, Dexie, Octokit

---

### Task 1: Add bootstrap container and app session orchestrator

**Files:**
- Create: `src/bootstrap/container.ts`
- Create: `src/bootstrap/appSession.ts`
- Create: `src/bootstrap/__tests__/appSession.test.ts`
- Modify: `src/App.vue`
- Modify: `src/services.ts`

**Step 1: Write the failing test**

Add tests for:
- bootstrapping theme and auth before workspace
- scheduling stale sync only when authenticated
- running background token verification after workspace init

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/bootstrap/__tests__/appSession.test.ts`
Expected: FAIL because the bootstrap module does not exist yet.

**Step 3: Write minimal implementation**

Create:
- a container that owns concrete instances
- an `AppSession` helper that exposes `bootstrap()` and `handleAuthChange()`

Keep `App.vue` as a thin view host that binds returned status only.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/bootstrap/__tests__/appSession.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bootstrap src/App.vue src/services.ts
git commit -m "refactor(app): extract bootstrap session orchestration"
```

### Task 2: Add application result type and auth facade

**Files:**
- Create: `src/core/application/dto/AppResult.ts`
- Create: `src/core/application/facades/AuthFacade.ts`
- Create: `src/core/application/facades/__tests__/AuthFacade.test.ts`
- Modify: `src/stores/useAuthStore.ts`
- Modify: `src/bootstrap/container.ts`

**Step 1: Write the failing test**

Cover:
- token restore from config
- successful token verification persistence
- invalid token reset path

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/application/facades/__tests__/AuthFacade.test.ts`
Expected: FAIL because the facade does not exist.

**Step 3: Write minimal implementation**

Move auth workflow orchestration into `AuthFacade`. Leave `useAuthStore` responsible for refs and facade calls only.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/core/application/facades/__tests__/AuthFacade.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/application/dto src/core/application/facades src/stores/useAuthStore.ts src/bootstrap/container.ts
git commit -m "refactor(auth): route auth workflow through facade"
```

### Task 3: Introduce workspace facades and split Nexus store responsibilities

**Files:**
- Create: `src/core/application/facades/WorkspaceFacade.ts`
- Create: `src/core/application/facades/HistoryFacade.ts`
- Create: `src/core/application/facades/VaultFacade.ts`
- Create: `src/core/application/facades/__tests__/WorkspaceFacade.test.ts`
- Create: `src/presentation/stores/useWorkspaceStore.ts`
- Create: `src/presentation/stores/useSelectionStore.ts`
- Create: `src/presentation/stores/useSyncStore.ts`
- Modify: `src/stores/useNexusStore.ts`
- Modify: `src/bootstrap/container.ts`

**Step 1: Write the failing test**

Cover:
- sync orchestration result mapping
- secure cache reset and secure toggle behavior
- history import and restore workflows

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/application/facades/__tests__/WorkspaceFacade.test.ts`
Expected: FAIL because the facades/stores do not exist.

**Step 3: Write minimal implementation**

Move cross-resource workflows out of `useNexusStore.ts`. Keep only UI-facing state adapters in presentation stores.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/core/application/facades/__tests__/WorkspaceFacade.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/application/facades src/presentation/stores src/stores/useNexusStore.ts src/bootstrap/container.ts
git commit -m "refactor(workspace): split store state from workflow orchestration"
```

### Task 4: Decompose Sidebar and EditorPane around facades/stores

**Files:**
- Create: `src/presentation/composables/useSidebarActions.ts`
- Create: `src/presentation/composables/useEditorSession.ts`
- Create: `src/components/layout/sidebar/CategoryTree.vue`
- Create: `src/components/layout/sidebar/VaultSettingsModal.vue`
- Create: `src/components/layout/editor/EditorToolbar.vue`
- Create: `src/components/layout/editor/EditorContent.vue`
- Modify: `src/components/layout/Sidebar.vue`
- Modify: `src/components/layout/EditorPane.vue`

**Step 1: Write the failing test**

Add focused component/composable tests for:
- sidebar action dispatching without direct infrastructure imports
- editor save/export/secure-toggle flows through composables

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/layout`
Expected: FAIL because new composables/components do not exist.

**Step 3: Write minimal implementation**

Split both layout files so they consume stores/facades only. Remove direct imports of `cryptoProvider` and storage repositories from components.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/layout`
Expected: PASS

**Step 5: Commit**

```bash
git add src/presentation/composables src/components/layout
git commit -m "refactor(ui): remove infrastructure coupling from layout components"
```

### Task 5: Split sync core internals without behavior change

**Files:**
- Create: `src/core/application/services/sync/SyncDownCoordinator.ts`
- Create: `src/core/application/services/sync/PushIndexService.ts`
- Create: `src/core/application/services/sync/PushFileService.ts`
- Create: `src/core/application/services/sync/ShardCoordinator.ts`
- Create: `src/core/application/services/sync/ShardRepairService.ts`
- Create: `src/core/application/services/sync/__tests__/`
- Modify: `src/core/application/services/SyncService.ts`

**Step 1: Write the failing test**

Add regression tests around:
- conflict detection behavior
- v2 index/shard sync-down
- secure file push
- shard repair summary

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/application/services/__tests__/SyncService.test.ts`
Expected: FAIL when new seams are referenced but not implemented.

**Step 3: Write minimal implementation**

Extract orchestration helpers one slice at a time, preserving existing external API first. Tighten ambiguous warning-and-continue paths into explicit results where behavior is expected.

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/core/application/services/__tests__/SyncService.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/application/services
git commit -m "refactor(sync): split sync core by responsibility"
```

### Task 6: Final verification

**Files:**
- Modify: impacted files only

**Step 1: Run focused tests**

Run:
- `npm run test -- src/bootstrap/__tests__/appSession.test.ts`
- `npm run test -- src/core/application/facades/__tests__/AuthFacade.test.ts`
- `npm run test -- src/core/application/facades/__tests__/WorkspaceFacade.test.ts`
- `npm run test -- src/core/application/services/__tests__/SyncService.test.ts`

Expected: PASS

**Step 2: Run full verification**

Run:
- `npm run typecheck`
- `npm run test`

Expected: PASS with no new failures.

**Step 3: Commit**

```bash
git add .
git commit -m "refactor: restore presentation and application boundaries"
```
