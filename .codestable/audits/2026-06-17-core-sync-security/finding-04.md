---
doc_type: audit-finding
id: finding-04
title: PBKDF2 使用全局静态 Salt
nature: security
severity: P1
confidence: high
action: cs-refactor
status: reported
---

# Finding 04 — PBKDF2 全局静态 Salt（P1）

## 证据

`WebCryptoProvider.ts:22`：

```ts
private readonly SALT = new TextEncoder().encode("Nexus_Security_Salt_v1");
```

`deriveKey()`（:120）对所有用户、所有 vault 使用这个**硬编码常量 salt**，迭代
10 万次 PBKDF2-SHA256。后果：

1. 相同密码 ⇒ 相同派生密钥（跨用户）。salt 的核心作用——阻止预计算/彩虹表、
   隔离用户——完全失效。
2. 攻击者可针对这一个 salt 预计算字典，一次投入攻击所有 Nexus 用户的密文。

由于 Gist 是私有的，密文不公开可见，风险被部分缓解；但“私有 Gist 泄露”或
“token 泄露”场景下，静态 salt 让离线爆破成本大幅降低。

## 影响

削弱 E2EE 的口令强度保证。P1 / high（属设计缺陷而非触发型 bug）。

## 建议修复（需迁移，勿在审计内擅改）

per-vault 随机 salt（16+ 字节），与密文一同存储（salt 不需保密）。难点：存量
密文用旧静态 salt 派生的密钥加密，切换需：

- 信封/索引中新增 `kdfSalt` 字段；
- 旧数据回退到静态 salt 解密，再用新随机 salt 重新加密（懒迁移）。

建议开 `cs-refactor`，与 Finding 03 一并设计加密层 v2。
