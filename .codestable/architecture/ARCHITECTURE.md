# Project Nexus 架构总入口

> 状态：骨架（基于 README.md 回填，待逐步完善）
> 创建日期：2026-06-17

## 1. 项目简介

Project Nexus 是一个**分布式配置指挥中心**，以浏览器扩展 / Web 形态运行。
严格遵循**整洁架构 (Clean Architecture)** + **本地优先 (Local-First)** + **领域驱动设计 (DDD)**，
将业务逻辑与 UI、基础设施分离。

- 主存储：GitHub Gist（私有）
- 本地缓存：IndexedDB（Dexie.js）

## 2. 核心概念 / 术语表

- **NexusFile**：配置文件的聚合根，封装文件名生成逻辑（`id` + `language` -> `filename`）和脏状态跟踪。
- **NexusIndex**：文件结构索引，关键的 `nexus_index.json` 维护文件清单与组织结构。
- **LanguageRegistry**：领域服务，根据语言标识符生成标准文件扩展名。
- **Secure Mode**：文件级 E2EE 加密标记，敏感配置（API Keys/Secrets）专用。

## 3. 子系统 / 模块索引

按整洁架构分层（依赖方向由外向内）：

- **领域层 `src/core/domain/`**（内环，纯 TS）
  - `entities/` 充血模型（NexusFile）
  - `services/` 领域服务（LanguageRegistry）
  - `shared/` 共享内核（IdGenerator）
- **应用层 `src/core/application/`**
  - `ports/` 仓储接口（IGistRepository, IFileRepository）
  - `services/` 用例编排（SyncService, FileService）
- **基础设施层 `src/infrastructure/`**（外环，适配器实现）
  - `db/` 本地持久化（Dexie）
  - `github/` 外部 API（Octokit）
  - `storage/` 配置存储（LocalStorage / Chrome Storage）
- **表现层 `src/stores/`**
  - `useNexusStore.ts` ViewModel / 控制器逻辑（Vue 3 + Pinia）
- **依赖注入 `src/services.ts`**：DI 容器

## 4. 关键架构决定

- **同步策略**：智能同步——增量元数据检查（Gist `updated_at`）触发全量拉取；基于时间戳的冲突检测。
- **文件修改流程**：更新本地 DB -> 更新内存索引 -> 异步推送 Gist（乐观更新）。
- **索引一致性**：`nexus_index.json` 的结构变更立即推送 Gist。
- **历史回滚**：每次保存自动在 `NexusDB.history` 建快照；本地优先，本地为空时支持从 Gist 导入；Monaco Diff Editor 做全屏对比。
- **E2EE 加密**：AES-GCM；PBKDF2 从用户保险库密码 + Salt 派生密钥；密码仅暂存 Session/LocalStorage 绝不上传；Gist 存 Base64 密文，本地按需解密；文件级粒度。

## 5. 已知约束 / 硬边界

- **依赖方向**：基础设施层实现应用层 ports，领域层不依赖任何外环。
- **包管理器**：仅支持 `npm`（Node >= 18.18.0，npm >= 9.0.0）。
- **密钥**：保险库密码绝不上传云端。
- **测试覆盖率门禁（Vitest）**：lines 25 / functions 55 / branches 55 / statements 25。
