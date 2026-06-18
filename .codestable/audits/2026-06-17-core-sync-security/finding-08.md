---
doc_type: audit-finding
id: finding-08
title: 重复 composable 目录
nature: maintainability
severity: P2
confidence: high
action: cs-refactor
status: reported
---

# Finding 08 — 两套并存的 composable 目录（P2）

## 证据

`useEditorSession` / `useSidebarActions` 在两处各有一份实现：

- `src/presentation/composables/`（新边界，`useEditorSession.ts`、`useSidebarActions.ts`）
- `src/components/layout/composables/`（旧位置，含更完整的 UI 逻辑如 export/快捷键）

`ARCHITECTURE.md:95` 已将其列为“重构交接遗留风险，待判断是否合并”。两份
`useEditorSession` 逻辑已出现分叉（presentation 版无 export/dialog，components 版
有），后续容易改一处漏一处。

## 影响

维护成本翻倍、行为分叉风险。无数据/安全风险。P2 / maintainability。

## 建议修复

确定单一归属（按架构边界应落 `presentation/composables/`），把 UI 专属逻辑
（export modal、message/dialog 注入）以参数注入方式合并，删除旧目录。建议开
`cs-refactor` 专项处理（涉及组件 import 重定向，需测试覆盖）。
