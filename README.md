# Project Nexus

<div align="center">

**分布式配置指挥舱** | Distributed Configuration Command Center

_Your digital second brain, synced in silence._

[![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883?logo=vue.js)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ✨ 特性

- 🔐 **零信任架构** - 数据存储在你的 Private Gist，无第三方服务器
- 🎨 **深色/浅色主题** - 自动跟随系统或手动切换
- ⚡ **全键盘操作** - `Ctrl+P` 搜索, `Ctrl+S` 保存
- 📝 **Monaco 编辑器** - VS Code 同款内核，语法高亮
- 🔍 **模糊搜索** - 基于 Fuse.js 的高性能搜索
- 📱 **本地优先** - 离线可用，上线自动同步

---

## 🛠️ 技术栈

| 模块          | 技术选型                  |
| ------------- | ------------------------- |
| **Framework** | Vue 3 + TypeScript        |
| **Build**     | Vite + @crxjs/vite-plugin |
| **State**     | Pinia                     |
| **UI**        | Naive UI + UnoCSS         |
| **Editor**    | Monaco Editor             |
| **Search**    | Fuse.js                   |
| **API**       | Octokit (GitHub API)      |

---

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm / pnpm

### 开发模式

```bash
# 安装依赖
npm install

# Web 预览模式 (推荐)
npm run dev:web
# 访问 http://localhost:3333

# 浏览器扩展模式
npm run dev
# 在 chrome://extensions 加载 dist 目录
```

### 构建生产版本

```bash
npm run build
```

---

## 📁 项目结构

```
src/
├── core/domain/          # 核心领域层 - 类型定义
├── infrastructure/       # 基础设施层 - GitHub API / 本地存储
├── stores/               # 状态管理 - Pinia stores
├── views/                # 页面视图
├── components/           # UI 组件
│   ├── layout/           # 布局组件 (Sidebar, ConfigList, EditorPane)
│   └── GlobalSearch.vue  # 全局搜索
├── App.vue               # 根组件
└── main.ts               # 入口文件
```

---

## 🎯 功能清单

### ✅ 已实现

- [x] GitHub Token 认证与 Gist 同步
- [x] 三栏布局 (分类 → 列表 → 编辑器)
- [x] 分类和配置的 CRUD 操作
- [x] 右键菜单支持
- [x] 深色/浅色/自动主题切换
- [x] 全局搜索 (Ctrl+P)
- [x] Monaco 编辑器集成
- [x] 编辑器只读模式
- [x] 多语言语法高亮

### 🚧 开发中

- [ ] 版本历史 - 查看和回滚 Gist 历史版本
- [ ] 编辑器增强 - 代码格式化、查找替换、字体调整

### 📋 计划中

- [ ] 收藏/置顶功能
- [ ] 批量操作 (多选、批量删除)
- [ ] 快捷键系统增强
- [ ] 拖拽排序 (分类和配置)
- [ ] 离线支持优化
- [ ] 标签过滤系统
- [ ] 导入/导出功能

---

## ⌨️ 快捷键

| 快捷键     | 功能         |
| ---------- | ------------ |
| `Ctrl + P` | 全局搜索     |
| `Ctrl + S` | 保存当前文件 |
| `Ctrl + F` | 查找         |
| `Ctrl + H` | 替换         |
| `Ctrl + G` | 跳转到行     |

---

## 📄 License

[MIT](LICENSE)

---

<div align="center">

_Built with ❤️ by Antigravity Agent_

</div>
