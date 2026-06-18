---
doc_type: audit-finding
id: finding-05
title: IdGenerator 用 Math.random + 弃用 substr
nature: bug
severity: P2
confidence: medium
action: cs-refactor
status: fixed
---

# Finding 05 — IdGenerator 碰撞且实现不稳定（P2）

## 证据

`src/core/domain/shared/IdGenerator.ts:3`：

```ts
return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
```

问题：

1. 随机部分仅 5 个 base36 字符（~26 bit）+ 毫秒时间戳。同一毫秒内连续创建多个
   文件/分类（导入、批量、脚本）有真实碰撞概率，碰撞后 `id` 冲突会导致索引项
   覆盖、文件错配。
2. `String.prototype.substr` 已弃用；当 `Math.random().toString(36)` 末尾为 0 被
   截断时，实际随机位可能 < 5，进一步缩小空间。
3. 非加密随机，`Math.random()` 可预测（对本场景影响小，但无必要）。

`id` 用于 NexusFile / category 主键（`FileService.ts:30`、`WorkspaceFacade.ts:105`）。

## 影响

低频但真实的主键碰撞，后果是数据错配/覆盖。P2 / medium。

## 修复（本次已实施）

改用 `crypto.randomUUID()`，并保留无该 API 环境的降级实现（`getRandomValues`
拼接），移除 `substr`。`id` 是不透明字符串，存量旧 id 不受影响，仅新 id 变长。
