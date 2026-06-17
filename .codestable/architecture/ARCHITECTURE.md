# Project Nexus 架构总入口

> 状态：骨架（基于 2026-03-10 架构重构后的真实代码回填）
> 创建日期：2026-06-17

## 1. 项目简介

Project Nexus 是一个**分布式配置指挥中心**，以浏览器扩展 / Web 形态运行。
严格遵循**整洁架构 (Clean Architecture)** + **本地优先 (Local-First)** + **领域驱动设计 (DDD)**，
将业务逻辑与 UI、基础设施分离。2026-03 经过一次边界重构，引入 bootstrap 组合根、
application facades、presentation stores 三层，把编排逻辑从 store / 组件中抽离。

- 主存储：GitHub Gist（私有，v2 分片结构）
- 本地缓存：IndexedDB（Dexie.js，NexusDB v4）

## 2. 核心概念 / 术语表

- **NexusFile**：配置文件聚合根，封装文件名生成（`id` + `language` -> `filename`）和脏状态跟踪。
- **NexusIndex / nexus_index.json**：根索引，维护文件清单、分片描述符（shards）。
- **Shard（分片）**：Gist 存储的分片单元，每个 shard 有独立 gist + manifest，记录文件列表/校验和/字节数。
- **ShardManifest**：单个分片的文件清单（fileId / filename / checksum / size / isSecure）。
- **LanguageRegistry**：领域服务，按语言标识符生成标准文件扩展名。
- **Facade**：application 层面向表现层的编排边界（Auth / Workspace / Sync / History / Vault）。
- **AppResult<T>**：application 层显式结果类型（`{ok:true,data}` | `{ok:false,code,message}`），区分预期失败与编程错误。
- **Secure Mode / Vault**：文件级 E2EE 加密；保险库密码（PBKDF2 派生 AES-GCM 密钥）。
- **SyncHead**：持久化的同步基准，用于启动时快捷判断是否需要拉取。

## 3. 子系统 / 模块索引

依赖方向由外向内（presentation → application → domain；infrastructure 实现 ports）。

### 领域层 `src/core/domain/`（内环，纯 TS，无框架依赖）
- `entities/` — `NexusFile`（充血模型）、`types.ts`（NexusIndex/Shard/Storage 等类型）
- `services/` — `LanguageRegistry`（语言→扩展名）
- `shared/` — `Hash`（checksum）、`IdGenerator`

### 应用层 `src/core/application/`
- `dto/` — `AppResult`（统一结果类型）
- `ports/` — `IGistRepository` / `IFileRepository` / `ILocalStore` / `ICryptoProvider`
- `facades/` — `AuthFacade` / `WorkspaceFacade` / `SyncFacade` / `HistoryFacade` / `VaultFacade`
- `services/` — `FileService`、`SyncService`、`ShardManifestService`
- `services/sync/` — sync 核心按职责拆分的协作者：
  `ConflictGuard`、`SyncDownCoordinator`、`RemoteFileSyncService`、`LegacyMigrationService`、
  `ShardAllocationService`、`ShardUpsertService`、`ShardPullService`、`ShardFetchPlanner`、
  `ShardStateService`、`ShardRepairService`、`SyncHead`、`SyncConstants`、`SyncTypes`

### 基础设施层 `src/infrastructure/`（外环，适配器实现）
- `db/` — `NexusDatabase`（Dexie，files/history 表）、`LocalFileRepository`
- `github/` — `GistRepository`（Octokit，实现 IGistRepository）
- `security/` — `WebCryptoProvider`（实现 ICryptoProvider，AES-GCM + PBKDF2，session/可信设备缓存）
- `storage/` — `LocalStore`（配置存储，实现 ILocalStore）、`LocalHistoryRepository`（历史快照）
- `index.ts` — 不再对表现层导出可直接消费的单例（重构边界规则）

### 组合根 / 引导 `src/bootstrap/`
- `container.ts` — 唯一装配根，持有 concrete 实例
- `appSession.ts` — 启动编排（theme/auth/workspace 初始化、stale sync 调度、后台 token 校验）

### 表现层
- `src/presentation/stores/` — UI 状态 store：`useWorkspaceStore` / `useSelectionStore` /
  `useSyncStore` / `useVaultStore` / `useHistoryStore`、`workspaceState`
- `src/presentation/composables/` — `useEditorSession` / `useSidebarActions`
- `src/stores/` — `useAuthStore`、`useThemeStore`（薄状态适配器）
- `src/components/` — Vue 组件
  - `layout/` — `Sidebar`、`EditorPane`、`ConfigList`、`VersionHistory`
  - `layout/editor/` — `EditorPaneToolbar` / `EditorPaneContent` / `EditorPaneExportModal`
  - `layout/sidebar/` — `SidebarCategoryTree` / `SidebarActionsPanel` / `SidebarCategoryModal` / `SidebarVaultSettingsModal`
  - `layout/composables/` — `useEditorSession` / `useSidebarActions`（见 §5 遗留风险）
  - `codemirror/languageExtensions.ts`、`CodeMirrorEditor`、`CodeMirrorMergeEditor`、`GlobalSearch`、`Logo`
- `src/views/` — `CommandCenter`（主工作台，异步加载布局组件）、`Welcome`
- `src/services.ts` — DI 容器入口（兼容旧调用）
- `src/background.ts` — 浏览器扩展 background

## 4. 关键架构决定

- **边界规则**（2026-03 重构）：Vue 组件禁止 import `src/infrastructure/*` 和全局单例（如 cryptoProvider）；
  Pinia store 不直接编排远程/本地/历史/安全工作流；跨资源工作流落在 `application/facades` 或 `services/sync`；
  `bootstrap/container.ts` 是唯一装配根。
- **错误处理模型**：domain/use-case 仅对意外编程错误抛异常；预期工作流失败返回显式 `AppResult`；
  表现层把 result code 映射成用户提示。
- **同步策略**：智能同步——增量元数据检查（Gist `updated_at` / SyncHead）触发拉取；
  `ConflictGuard` 做基于时间戳的显式冲突检测（不再"检查失败继续写"）。
- **分片并发**：`ShardFetchPlanner` 对 manifest 与文件拉取做有界并发。
- **历史回滚**：每次保存自动在 `NexusDB.history` 建快照；本地优先，本地为空时从 Gist 导入；Monaco/CodeMirror Merge 做对比。
- **E2EE**：AES-GCM；PBKDF2（10 万次迭代）从保险库密码 + Salt 派生密钥；密码仅暂存 session / 可信设备，绝不上传；
  Gist 存 `IV:密文`（均 Base64），本地按需解密；文件级粒度。

## 5. 已知约束 / 硬边界

- **依赖方向**：基础设施实现应用层 ports，领域层不依赖任何外环。
- **包管理器**：仅支持 `npm`（Node >= 18.18.0，npm >= 9.0.0）。
- **密钥**：保险库密码绝不上传云端。
- **测试覆盖率门禁（Vitest，重构后已提升）**：lines 35 / statements 35 / functions 60 / branches 60。
- **遗留风险（来自重构交接，未在 onboard 阶段处理）**：
  - `SyncService.ts` 仍偏大（约 940 行，未达 300 行目标）。
  - 疑似重复的 composable 目录：`src/components/layout/composables/` 与 `src/presentation/composables/`，待判断是否合并。
  - `eslint.config.mjs` 可运行但多数质量规则（complexity / max-lines / no-explicit-any 等）尚未强约束。
