---
doc_type: audit-finding
id: finding-06
title: pushIndex 用 null shardState 重建 SyncHead
nature: maintainability
severity: P2
confidence: medium
action: cs-refactor
status: reported
---

# Finding 06 — pushIndex 写入失真的 shardStateHash（P2）

## 证据

`SyncService.pushIndex()`（`SyncService.ts:164`）在 v2 路径写 SyncHead：

```ts
[NEXUS_SYNC_HEAD_FILENAME]: serializeSyncHead(buildSyncHead(index, null, 3)),
```

`buildSyncHead(index, null)`（`SyncHead.ts:23`）把 `shardStateHash` 算成
`calculateChecksum(JSON.stringify({ shards: [] }))`——一个**与真实 shard_state
文件无关的空值哈希**。而 `ShardStateService.updateRootShardState`（:135）写的是
基于真实 manifest 的正确 SyncHead。两条写路径产出的 `shardStateHash` 语义不一致：
任何 index-only 操作（加分类、改名）后，root 上的 `nexus_sync_head.json`
`shardStateHash` 字段就不再反映真实分片状态。

## 影响

数据不会丢失（`SyncDownCoordinator` 实际比对的是 `nexus_shard_state.json` 而非
SyncHead 内部字段；且 SyncHead 整文件哈希每次都会变，不会误跳过）。但该字段
失真破坏了 SyncHead“一致快照”的不变式，是潜在维护陷阱：后续若有人据此字段做
判断会踩坑。P2 / maintainability。

## 建议修复

`pushIndex` 不应用 `null` 重建 shardState 部分。两种方案：
- index-only push 时不重写 `nexus_sync_head.json`（仅改 index/shards，让 head 由
  分片写路径统一维护）；或
- 传入当前已知 shardState（从 config.shardStateDigest 或读一次远端）重建。

建议开 `cs-refactor`。
