---
doc_type: audit-finding
id: finding-01
title: 全新 Gist 初始化后首次写入被 ConflictGuard 误判冲突
nature: bug
severity: P0
confidence: high
action: cs-issue
status: fixed
---

# Finding 01 — 新用户首次写入必失败（P0）

## 证据

`WorkspaceFacade.initializeGist()`（`src/core/application/facades/WorkspaceFacade.ts:67`）
创建 Gist 后，只把 `gistId/rootGistId/schemaVersion` 写进 config，**没有记录
`lastRemoteUpdatedAt`**。`useWorkspaceStore.initializeGist()`
（`src/presentation/stores/useWorkspaceStore.ts:60`）也未设置 `remoteUpdatedAt`，
故 `remoteUpdatedAt.value` 保持 `null`。

随后任何写入（新建分类/文件/保存）走 `FileService` → `SyncService.pushIndex()`
（`SyncService.ts:148`）→ `ConflictGuard.assertCanPush()`：

```ts
// ConflictGuard.ts:12
const remoteTime = new Date(meta.updated_at).getTime();
const localTime = lastKnownRemoteTime ? new Date(lastKnownRemoteTime).getTime() : 0;
if (remoteTime > localTime) {
  throw new Error("检测到同步冲突！远程数据已被其他设备更新。");
}
```

`initializeNexus`（`SyncService.ts:119`）创建 Gist 时其 `updated_at` 必然 > 0，而
`lastKnownRemoteTime` 为 `null` ⇒ `localTime = 0` ⇒ `remoteTime > 0` 永真 ⇒
**首次写入 100% 抛“同步冲突”**。新用户初始化后第一个动作就报错。

## 影响

全新用户路径（最常见的 onboarding）首个写操作即失败，必须手动 force 才能继续。
高频、可复现、影响核心首用体验。P0。

## 触发

1. 全新账号，无既有 Nexus Gist
2. 点击初始化 → 创建分类或文件
3. 立即弹出“检测到同步冲突”

## 建议修复

`initializeNexus` 回传创建时的 `updated_at`，由 `initializeGist` 一路写入
`config.lastRemoteUpdatedAt` 与 store 的 `remoteUpdatedAt`，让冲突基线从一开始
就对齐远端。本次审计已实施 + 回归测试。
