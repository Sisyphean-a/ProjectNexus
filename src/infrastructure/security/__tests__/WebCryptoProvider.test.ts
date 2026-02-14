import { beforeEach, describe, expect, it } from "vitest";
import { WebCryptoProvider } from "../WebCryptoProvider";

const SESSION_PASSWORD_KEY = "nexus_vault_password_session";
const LEGACY_LOCAL_PASSWORD_KEY = "nexus_vault_password";

describe("WebCryptoProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("默认设置密码时不持久化到存储", async () => {
    const provider = new WebCryptoProvider();
    await provider.setPassword("vault-pass");

    expect(provider.hasPassword()).toBe(true);
    expect(window.sessionStorage.getItem(SESSION_PASSWORD_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_LOCAL_PASSWORD_KEY)).toBeNull();
  });

  it("可选择在当前会话中记住密码", async () => {
    const provider = new WebCryptoProvider();
    await provider.setPassword("vault-pass", { rememberInSession: true });

    expect(window.sessionStorage.getItem(SESSION_PASSWORD_KEY)).toBe(
      "vault-pass",
    );
  });

  it("clearPassword 会清除内存密钥与会话缓存", async () => {
    const provider = new WebCryptoProvider();
    await provider.setPassword("vault-pass", { rememberInSession: true });

    provider.clearPassword();

    expect(provider.hasPassword()).toBe(false);
    expect(window.sessionStorage.getItem(SESSION_PASSWORD_KEY)).toBeNull();
  });

  it("启动时会清理旧版 localStorage 明文密码", () => {
    window.localStorage.setItem(LEGACY_LOCAL_PASSWORD_KEY, "legacy-pass");
    new WebCryptoProvider();
    expect(window.localStorage.getItem(LEGACY_LOCAL_PASSWORD_KEY)).toBeNull();
  });

  it("未设置密码时 hasPassword 为 false", () => {
    const provider = new WebCryptoProvider();
    expect(provider.hasPassword()).toBe(false);
  });

  it("encrypt 返回 IV 与密文的拼接格式", async () => {
    const provider = new WebCryptoProvider();
    await provider.setPassword("vault-pass");

    const encrypted = await provider.encrypt("secret");
    const parts = encrypted.split(":");

    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
  });

  it("decrypt 在格式非法时抛错", async () => {
    const provider = new WebCryptoProvider();
    await provider.setPassword("vault-pass");

    await expect(provider.decrypt("invalid-format")).rejects.toThrow(
      "Invalid encrypted format",
    );
  });
});
