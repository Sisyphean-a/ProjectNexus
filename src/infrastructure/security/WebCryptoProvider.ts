import type {
  ICryptoProvider,
  SetPasswordOptions,
} from "../../core/application/ports/ICryptoProvider";

const SESSION_PASSWORD_KEY = "nexus_vault_password_session";
const LEGACY_LOCAL_PASSWORD_KEY = "nexus_vault_password";
const TRUSTED_PASSWORD_ENVELOPE_KEY = "nexus_vault_password_trusted_envelope";
const TRUSTED_DEVICE_SECRET_KEY = "nexus_vault_device_secret";
const TRUSTED_PASSWORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface TrustedPasswordEnvelope {
  version: 1;
  iv: string;
  content: string;
  createdAt: string;
  expiresAt: string;
}

export class WebCryptoProvider implements ICryptoProvider {
  private key: CryptoKey | null = null;
  private readonly SALT = new TextEncoder().encode("Nexus_Security_Salt_v1");
  private readonly TRUSTED_SALT = new TextEncoder().encode(
    "Nexus_Trusted_Device_Salt_v1",
  );

  constructor(
    private sessionStorage: Storage = window.sessionStorage,
    private localStorage: Storage = window.localStorage,
  ) {
    this.clearLegacyPasswordCache();
    this.tryLoadFromSession();
    this.tryLoadFromTrustedDevice();
  }

  private tryLoadFromSession(): void {
    const savedPwd = this.sessionStorage.getItem(SESSION_PASSWORD_KEY);
    if (savedPwd) {
      void this.setPassword(savedPwd, { rememberInSession: true });
    }
  }

  private clearLegacyPasswordCache(): void {
    try {
      this.localStorage.removeItem(LEGACY_LOCAL_PASSWORD_KEY);
    } catch {
      // ignore storage failures (e.g. privacy mode)
    }
  }

  hasPassword(): boolean {
    return !!this.key;
  }

  async setPassword(
    password: string,
    options: SetPasswordOptions = {},
  ): Promise<void> {
    const rememberMode = this.resolveRememberMode(options);
    this.applySessionPersistence(password, rememberMode);
    await this.applyTrustedPersistence(password, rememberMode);
    this.key = await this.deriveKey(password);
  }

  clearPassword(): void {
    this.key = null;
    this.sessionStorage.removeItem(SESSION_PASSWORD_KEY);
  }

  async encrypt(text: string): Promise<string> {
    if (!this.key) throw new Error("Vault password not set");

    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    // 12 bytes IV for AES-GCM
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encryptedContent = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      this.key,
      data
    );

    // Combine IV and ciphertext for storage: IV (Base64) + ":" + Ciphertext (Base64)
    const ivB64 = this.arrayBufferToBase64(iv);
    const contentB64 = this.arrayBufferToBase64(encryptedContent);

    return `${ivB64}:${contentB64}`;
  }

  async decrypt(encryptedText: string): Promise<string> {
    if (!this.key) throw new Error("Vault password not set");

    const parts = encryptedText.split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid encrypted format");
    }

    const iv = this.base64ToArrayBuffer(parts[0]);
    const ciphertext = this.base64ToArrayBuffer(parts[1]);

    try {
      const decryptedContent = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(iv),
        },
        this.key,
        ciphertext
      );
      return new TextDecoder().decode(decryptedContent);
    } catch {
      throw new Error("Decryption failed. Wrong password?");
    }
  }

  private async deriveKey(password: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: this.SALT,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  private resolveRememberMode(
    options: SetPasswordOptions,
  ): "memory" | "session" | "trustedDevice" {
    if (options.rememberMode) {
      return options.rememberMode;
    }
    return options.rememberInSession ? "session" : "memory";
  }

  private applySessionPersistence(
    password: string,
    mode: "memory" | "session" | "trustedDevice",
  ): void {
    if (mode === "session") {
      this.sessionStorage.setItem(SESSION_PASSWORD_KEY, password);
      return;
    }
    this.sessionStorage.removeItem(SESSION_PASSWORD_KEY);
  }

  private async applyTrustedPersistence(
    password: string,
    mode: "memory" | "session" | "trustedDevice",
  ): Promise<void> {
    if (mode !== "trustedDevice") {
      this.clearTrustedEnvelope();
      return;
    }

    const trustedKey = await this.deriveTrustedKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(password);
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      trustedKey,
      data,
    );
    const now = new Date();
    const envelope: TrustedPasswordEnvelope = {
      version: 1,
      iv: this.arrayBufferToBase64(iv),
      content: this.arrayBufferToBase64(encrypted),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TRUSTED_PASSWORD_TTL_MS).toISOString(),
    };
    this.localStorage.setItem(
      TRUSTED_PASSWORD_ENVELOPE_KEY,
      JSON.stringify(envelope),
    );
  }

  private async tryLoadFromTrustedDevice(): Promise<void> {
    const raw = this.localStorage.getItem(TRUSTED_PASSWORD_ENVELOPE_KEY);
    if (!raw) {
      return;
    }

    const envelope = this.parseEnvelope(raw);
    if (!envelope) {
      this.clearTrustedEnvelope();
      return;
    }

    if (Date.parse(envelope.expiresAt) <= Date.now()) {
      this.clearTrustedEnvelope();
      return;
    }

    try {
      const trustedKey = await this.deriveTrustedKey();
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(this.base64ToArrayBuffer(envelope.iv)) },
        trustedKey,
        this.base64ToArrayBuffer(envelope.content),
      );
      const password = new TextDecoder().decode(decrypted);
      await this.setPassword(password, { rememberMode: "trustedDevice" });
    } catch (e) {
      console.warn("[WebCryptoProvider] Trusted device restore failed", e);
      this.clearTrustedEnvelope();
    }
  }

  private parseEnvelope(raw: string): TrustedPasswordEnvelope | null {
    try {
      const parsed = JSON.parse(raw) as TrustedPasswordEnvelope;
      if (!parsed || parsed.version !== 1 || !parsed.iv || !parsed.content) {
        return null;
      }
      if (!parsed.expiresAt || !parsed.createdAt) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private clearTrustedEnvelope(): void {
    this.localStorage.removeItem(TRUSTED_PASSWORD_ENVELOPE_KEY);
  }

  private async deriveTrustedKey(): Promise<CryptoKey> {
    const secret = this.getOrCreateTrustedSecret();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: this.TRUSTED_SALT,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  private getOrCreateTrustedSecret(): string {
    const existing = this.localStorage.getItem(TRUSTED_DEVICE_SECRET_KEY);
    if (existing) {
      return existing;
    }
    const random = window.crypto.getRandomValues(new Uint8Array(32));
    const secret = this.arrayBufferToBase64(random);
    this.localStorage.setItem(TRUSTED_DEVICE_SECRET_KEY, secret);
    return secret;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
