# Project Nexus

**Project Nexus** 是一个基于 **Vue 3** 和 **TypeScript** 构建的浏览器扩展（Command Center）。它旨在提供一个“本地优先、云端同步”的配置管理与笔记环境，充当用户的“数字第二大脑”。

核心理念：**Local-First**（本地优先）、**Gist Sync**（Gist 同步）、**Cyberpunk UI**（赛博风格指挥舱）。

## 1. 项目架构 (Architecture)

本项目采用清晰的分层架构（Clean Architecture），确保业务逻辑与基础设施解耦。

### 1.1 目录结构

```
src/
├── core/                   # 核心领域层 (Domain Layer)
│   └── domain/
│       └── types.ts        # 核心接口定义 (NexusIndex, NexusConfig, GistFile)
├── infrastructure/         # 基础设施层 (Infrastructure Layer)
│   ├── github/             # GitHub API 交互实现
│   │   └── GistRepository.ts
│   ├── storage/            # 本地存储实现 (chrome.storage / localStorage)
│   │   └── LocalStore.ts
│   └── index.ts            # 依赖注入/单例导出
├── stores/                 # 应用状态层 (Application Layer / State Management)
│   ├── useAuthStore.ts     # 认证状态管理 (Token)
│   └── useNexusStore.ts    # 核心业务状态管理 (Sync, Index, Selection)
├── views/                  # 视图页面 (Presentation Layer)
│   ├── Welcome.vue         # 首次引导/登录页
│   └── CommandCenter.vue   # 主应用界面
├── components/             # UI 组件
│   └── layout/
│       ├── Sidebar.vue     # 左侧分类导航
│       ├── ConfigList.vue  # 中间配置列表 (集成 Fuse.js 搜索)
│       └── EditorPane.vue  # 右侧编辑器 (集成 Monaco Editor)
├── App.vue                 # 根组件 (Theme Config)
├── main.ts                 # Vue 入口
├── background.ts           # Service Worker (Extension Background)
├── manifest.json           # Manifest V3 配置
└── index.html              # HTML 入口
```

### 1.2 核心技术栈

-   **Frontend Framework**: Vue 3 (Script Setup)
-   **Build Tool**: Vite + @crxjs/vite-plugin
-   **State Management**: Pinia
-   **UI Framework**: Naive UI + TailwindCSS (UnoCSS)
-   **Editor**: Monaco Editor (@guolao/vue-monaco-editor)
-   **Search**: Fuse.js (Fuzzy Search)
-   **API Client**: Octokit (GitHub API)
-   **Persistence**: `chrome.storage.local` (Extension) / `localStorage` (Web Fallback)

## 2. 核心业务逻辑 (Core Domain)

### 2.1 数据模型
-   **NexusIndex**: 存储在 Gist 中的核心索引文件 (`nexus_index.json`)，包含分类 (`categories`) 和文件元数据 (`items`)。
-   **GistFile**: Gist 中的实际文件内容。
-   **NexusConfig**: 本地配置，包含 GitHub Token、Gist ID、同步间隔等。

### 2.2 同步策略 (Sync Strategy)
-   **Zero-Trust / Private**: 数据存储在用户的 Private Gist 中。
-   **Local-First**: 读取优先使用本地缓存 (`LocalStoreRepository`)，以确加载速度。
-   **Manual/Auto Sync**: `useNexusStore` 负责协调 `GistRepository` (云端) 和 `LocalStoreRepository` (本地) 的数据同步。

## 3. 开发指南 (Development Guide)

### 3.1 环境要求
-   Node.js 18+
-   pnpm / npm

### 3.2 运行开发环境

**模式 A: Web 预览模式 (推荐)**
无需加载扩展，直接在浏览器中预览 UI（Mock 了部分 Chrome API）。
```bash
npm run dev:web
# Access: http://localhost:3333
```

**模式 B: 扩展开发模式**
在真实扩展环境中调试。
```bash
npm run dev
# Load extension in chrome://extensions from 'dist' folder
```

### 3.3 构建生产版本
```bash
npm run build
```
产物位于 `dist/` 目录。

## 4. 关键功能点 (Features)
1.  **Welcome Flow**: 引导用户输入 GitHub Token 并验证权限 (`gist` scope)。
2.  **Command Center**: 三栏布局，支持键盘快捷键 (`Ctrl+S` 保存)。
3.  **Search**: 基于 Fuse.js 的高性能模糊搜索。
4.  **Edit**: 集成 Monaco Editor，支持多语言语法高亮。

---
*Created by Antigravity Agent*
