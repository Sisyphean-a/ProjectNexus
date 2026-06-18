---
doc_type: audit-finding
id: finding-03
title: 可信设备密码信封与其解密密钥同存 localStorage
nature: security
severity: P1
confidence: high
action: cs-issue
status: reported
---

# Finding 03 — 可信设备“加密”形同虚设（P1）

## 证据

`WebCryptoProvider`（`src/infrastructure/security/WebCryptoProvider.ts`）的可信设备
模式把 vault 密码用 AES-GCM 加密后存 localStorage（`applyTrustedPersistence:164`），
看似安全。但加密用的密钥派生自 `getOrCreateTrustedSecret()`（:269）：

```ts
const random = window.crypto.getRandomValues(new Uint8Array(32));
const secret = this.arrayBufferToBase64(random);
this.localStorage.setItem(TRUSTED_DEVICE_SECRET_KEY, secret);  // 明文存 localStorage
```

即：**密文（信封）与解开它的密钥（secret）存在同一个 localStorage**。任何能读
localStorage 的途径（XSS、恶意扩展、磁盘取证、同步到云的浏览器 profile）都能
同时拿到两者 ⇒ `deriveTrustedKey()` 复现 ⇒ 解出 vault 明文密码。

`ARCHITECTURE.md:84` 宣称“密码仅暂存 session / 可信设备，绝不上传”。可信设备这层
的加密对“本地攻击者”几乎不提供保护，只是混淆。

## 影响

E2EE 的根密码在可信设备上等价于明文落盘。违背架构安全承诺。P1 / high。
（注意：这是本地存储风险，不涉及上传云端，故非 P0。）

## 建议修复（需设计，勿在审计内擅改）

- 用 Web Crypto **不可导出（extractable:false）** 的 CryptoKey + IndexedDB 存
  key handle，使密钥无法被 JS 读出明文；或
- 接入 WebAuthn/passkey 作为可信设备解锁因子；或
- 至少把 secret 移出 localStorage（如 `chrome.storage` + 扩展隔离），并明确
  告知用户可信设备模式的威胁模型。

建议开 `cs-issue` 跟踪，单独评估。
