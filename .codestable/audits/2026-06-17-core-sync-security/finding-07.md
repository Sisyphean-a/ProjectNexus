---
doc_type: audit-finding
id: finding-07
title: 截断文件 raw 内容串行逐个拉取
nature: performance
severity: P2
confidence: low
action: cs-refactor
status: reported
---

# Finding 07 — 大文件 raw 拉取无并发（P2）

## 证据

`GistRepository.getGistContent` / `getGistFilesByNames`（:309 / :329）在循环里
`await this.normalizeFile(...)`，而 `normalizeFile`（:128）对 `truncated` 文件
会 `await this.fetchRawContent(file.raw_url)`：

```ts
for (const [filename, fileObj] of Object.entries(data.files)) {
  result[filename] = await this.normalizeFile(filename, file, data.updated_at); // 串行
}
```

一个分片内有 N 个被 GitHub 截断（>1MB）的大文件时，会发起 N 次**串行**网络请求。
分片拉取层（`ShardFetchPlanner`）已做有界并发，但单个 gist 内部的 raw 拉取仍是
顺序的。

## 影响

含多个大文件的分片同步变慢（N×RTT）。功能正确，纯性能。P2 / low（仅大文件场景）。

## 建议修复

`getGistContent` / `getGistFilesByNames` 内部对需要 `fetchRawContent` 的条目用
有界并发（复用 `mapWithConcurrency` 思路）。建议开 `cs-refactor`。
