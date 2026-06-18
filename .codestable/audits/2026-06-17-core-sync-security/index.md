---
doc_type: audit-index
date: 2026-06-17
slug: core-sync-security
status: active
scope:
  - src/core/application/services/sync/
  - src/core/application/services/SyncService.ts
  - src/core/application/services/ShardManifestService.ts
  - src/core/application/facades/
  - src/infrastructure/security/WebCryptoProvider.ts
  - src/infrastructure/github/GistRepository.ts
  - src/core/domain/shared/
dimensions: [bug, security, performance, maintainability]
---

# 审计：核心同步引擎 + 安全/加密 + 数据完整性

## 范围

聚焦“爆炸半径最大”的内核：E2EE 加密（vault/可信设备）、Gist 同步引擎、分片
（shard）与冲突/校验和数据完整性路径。共读取 ~25 个核心文件 + 编排层。
未覆盖：UI 组件渲染细节、CodeMirror 集成、纯展示型 store。

基线：`npx tsc --noEmit` 通过；`npx vitest run` 99/99 通过。

## 总评

架构分层清晰、职责拆分到位（facades / sync 协作者），但在**首次初始化写入**、
**校验和强度**、**可信设备密钥保管**三处存在真实风险。其中 1 条 P0（新用户
首写必失败）证据明确、可立即修复；2 条 P1 属安全设计权衡（改动会使存量加密
数据失效，需迁移策略，故只报不擅自改）。

## 发现清单（交叉分类）

| # | 标题 | 性质 | 严重度 | 置信度 | 建议动作 |
|---|---|---|---|---|---|
| 01 | 全新 Gist 初始化后首次写入被 ConflictGuard 误判冲突 | bug | **P0** | high | cs-issue（本次已修） |
| 02 | DJB2 32-bit 校验和作为唯一变更判据，碰撞致静默不同步 | bug/data-integrity | P1 | medium | cs-issue（本次加防御） |
| 03 | 可信设备密码信封与其解密密钥同存 localStorage，加密形同虚设 | security | P1 | high | cs-issue |
| 04 | PBKDF2 使用全局静态 Salt，跨用户可预计算 | security | P1 | high | cs-refactor |
| 05 | IdGenerator 用 Math.random + 弃用 substr，碰撞且不稳定 | bug | P2 | medium | cs-refactor（本次已修） |
| 06 | pushIndex 用 null shardState 重建 SyncHead，shardStateHash 失真 | maintainability | P2 | medium | cs-refactor |
| 07 | 截断文件 raw 内容串行逐个拉取，无并发 | performance | P2 | low | cs-refactor |
| 08 | 重复 composable 目录（presentation/ vs components/layout/） | maintainability | P2 | high | cs-refactor |

## 本次审计内已处理（用户目标=找出并修复）

- **#01** 已修复并加回归测试（`initializeNexus` 回传 `updated_at` 作为冲突基线）。
- **#02** 已加防御：分片拉取在 checksum 相等但 size 不同时仍拉取（廉价二次校验）。
- **#05** 已修复：`crypto.randomUUID()` + 降级方案，移除 `substr`。

## 下一步建议（按优先级）

- **P1 #03 / #04（安全）**：建议尽快开 `cs-issue` / `cs-refactor`，但二者均触及
  存量加密数据兼容性——需先定迁移方案（per-vault 随机 salt + 信封改用
  Web Crypto 非可导出密钥 / passkey），不宜在审计内擅自改。
- **P2 #06 / #07 / #08**：可排后续迭代，无数据风险。
