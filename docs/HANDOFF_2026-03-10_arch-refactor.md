# ProjectNexus 重构交接文档（2026-03-10）

## 1. 基本信息
- 工作树: `F:\Github\ProjectNexus\.worktrees\arch-refactor`
- 当前分支: `codex/architecture-refactor`
- Git 状态: 有较大规模未提交改动（见下文文件列表）

## 2. 当前是否“卡住”
不是硬卡住。当前状态是：
- `npm run typecheck` 通过
- `npm run test` 通过（25 files, 95 tests）
- `npm run lint` 通过

所以现在可继续开发或进入收尾阶段，不存在阻塞性报错。

## 3. 已完成的关键改动（高价值）

### 3.1 组合根与依赖边界
- 组合根集中到 `src/bootstrap/container.ts`
- `src/infrastructure/index.ts` 不再提供表现层可直接消费的单例出口
- 新增 facade：
  - `src/core/application/facades/WorkspaceFacade.ts`
  - `src/core/application/facades/SyncFacade.ts`
  - `src/core/application/facades/HistoryFacade.ts`
  - `src/core/application/facades/VaultFacade.ts`

### 3.2 Store 拆分与迁移
- 新增 presentation store：
  - `src/presentation/stores/useWorkspaceStore.ts`
  - `src/presentation/stores/useSelectionStore.ts`
  - `src/presentation/stores/useSyncStore.ts`
  - `src/presentation/stores/useVaultStore.ts`
  - `src/presentation/stores/useHistoryStore.ts`
- 删除旧巨石 store：`src/stores/useNexusStore.ts`
- 相关调用点已迁到新 store/composable（`App.vue`、`EditorPane.vue`、`Sidebar.vue` 等）

### 3.3 SyncService 风险路径修正 + 职责下沉
- `pushIndex` 冲突检查改为显式失败（不再“检查失败继续写”）
- 并发拉取通过 `ShardFetchPlanner`（manifest 与文件拉取有界并发）
- 新增同步协作者目录：`src/core/application/services/sync/`
  - `ConflictGuard.ts`
  - `ShardFetchPlanner.ts`
  - `ShardStateService.ts`
  - `ShardRepairService.ts`
  - `SyncConstants.ts`
  - `SyncTypes.ts`
- `SyncService.ts` 已从约 1400 行降至约 940 行（仍偏大，但已明显下降）

### 3.4 UI 拆分（Editor / Sidebar）
- Editor 已抽出 composable + 子组件：
  - `src/components/layout/composables/useEditorSession.ts`
  - `src/components/layout/editor/EditorPaneToolbar.vue`
  - `src/components/layout/editor/EditorPaneContent.vue`
  - `src/components/layout/editor/EditorPaneExportModal.vue`
- Sidebar 已抽出 composable + 子组件：
  - `src/components/layout/composables/useSidebarActions.ts`
  - `src/components/layout/sidebar/SidebarCategoryTree.vue`
  - `src/components/layout/sidebar/SidebarActionsPanel.vue`
  - `src/components/layout/sidebar/SidebarCategoryModal.vue`
  - `src/components/layout/sidebar/SidebarVaultSettingsModal.vue`
- `EditorPane.vue` / `Sidebar.vue` 已接线到上述结构

### 3.5 工程门禁
- `package.json` 已增加 `lint` 脚本
- `vite.config.mts` 覆盖率阈值已提升到：
  - lines 35
  - statements 35
  - functions 60
  - branches 60
- `eslint.config.mjs` 已非空（但质量规则仍需二次打磨，见下文）

## 4. 当前文件状态（变更范围）

### 已修改（节选重点）
- `src/bootstrap/container.ts`
- `src/core/application/services/SyncService.ts`
- `src/components/layout/EditorPane.vue`
- `src/components/layout/Sidebar.vue`
- `src/App.vue`
- `package.json`
- `eslint.config.mjs`
- `vite.config.mts`

### 新增目录（节选重点）
- `src/core/application/services/sync/`
- `src/presentation/`
- `src/components/layout/composables/`
- `src/components/layout/editor/`
- `src/components/layout/sidebar/`

### 删除
- `src/stores/useNexusStore.ts`
- `src/stores/__tests__/useNexusStore.behavior.test.ts`
- `src/stores/__tests__/useNexusStore.deleteCategory.test.ts`

## 5. “软卡点”与遗留风险（新对话优先处理）

1. `SyncService.ts` 仍约 940 行，未达到 300 行目标。
2. `eslint.config.mjs` 目前虽然可跑，但很多关键规则处于关闭状态（如 complexity、max-lines、max-depth、max-params、no-magic-numbers、no-explicit-any 等未真正强约束），与最初“质量门禁增强”目标不完全一致。
3. 当前存在两套 composable 测试目录：
   - `src/components/layout/composables/__tests__/*`
   - `src/presentation/composables/__tests__/*`
   需要在新对话里判断是否重复、是否应合并。
4. 当前是大改进行中分支，未做 commit 切片，建议新对话先按模块分批提交，降低回滚成本。

## 6. 新对话建议起手命令

在 `F:\Github\ProjectNexus\.worktrees\arch-refactor` 执行：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

然后优先做：
1. 继续拆 `SyncService.ts`（至少再拆 `syncDown` / `pullShardChanges` / legacy migration 协调逻辑）。
2. 把 `eslint.config.mjs` 从“可运行”升级到“真门禁”（按架构边界和复杂度约束落规则）。
3. 清理重复测试目录与命名，确保结构统一。

## 7. 交接结论
当前分支不是卡死状态，而是“功能已通 + 门禁可跑 + 重构未收尾”的中间态。可以直接在新对话接着做收口，不需要回退。
