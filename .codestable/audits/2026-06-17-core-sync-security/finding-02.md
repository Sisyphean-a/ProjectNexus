---
doc_type: audit-finding
id: finding-02
title: DJB2 32-bit 校验和作为唯一变更判据，碰撞致静默不同步
nature: bug
severity: P1
confidence: medium
action: cs-issue
status: mitigated
---

# Finding 02 — 校验和碰撞导致内容静默不更新（P1）

## 证据

`calculateChecksum`（`src/core/domain/shared/Hash.ts:5`）是 32-bit DJB2：

```ts
let hash = 5381;
for (...) hash = (hash << 5) + hash + str.charCodeAt(i);
return (hash >>> 0).toString(16);
```

它被当作**内容相等的唯一判据**，决定是否跳过下载：

```ts
// ShardPullService.ts:146 queueManifestFiles
const localFile = await this.deps.fileRepo.get(indexed.item.id);
if (localFile && localFile.checksum === manifestItem.checksum) {
  continue;   // 校验和相等 => 认为本地已最新，跳过拉取
}
```

32-bit 空间仅 ~43 亿，对“两份不同配置内容”发生碰撞的概率虽低，但 DJB2 对
小改动（如交换两字符、改一个数字）线性叠加，结构化文本（YAML/JSON）尤其容易
产生近似输入碰撞。一旦远端内容变了但 checksum 与本地旧内容相同，**该文件会被
永久跳过下载**，用户看到的是陈旧内容且无任何报错。

`ShardStateService.calculateManifestHash`、`SyncHead` 也用同一弱哈希，但它们是
“元数据是否变化”的快路径判据，碰撞只会导致漏掉一次同步检查（次要）。

## 影响

数据完整性：远端更新被静默丢弃，无报错、无重试。概率低但后果是“看到旧数据
而不自知”，对配置指挥中心是高代价。定 P1 / 置信度 medium（依赖碰撞实际发生）。

## 建议修复

理想：换 SHA-256（Web Crypto `subtle.digest` 已在项目内使用）。但 manifest 中
存量 checksum 是 DJB2，直接换算法会让所有文件一次性判定为“已变更”全量重拉
（功能正确、成本一次性）。本次审计采取**廉价防御**：在 `ShardPullService`
checksum 相等时，额外比较 `manifestItem.size` 与本地内容字节数，size 不同则仍
拉取——拦住最常见的“长度变化型”碰撞，零迁移成本。彻底切换 SHA-256 建议单独
开 `cs-refactor` 评估迁移。
