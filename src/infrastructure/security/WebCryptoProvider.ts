import type {
  ICryptoProvider,
  SetPasswordOptions,
} from "../../core/application/ports/ICryptoProvider";

const SESSION_PASSWORD_KEY = "nexus_vault_password_session";
const LEGACY_LOCAL_PASSWORD_KEY = "nexus_vault_password";

export class WebCryptoProvider implements ICryptoProvider {
  private key: CryptoKey | null = null;
  private readonly SALT = new TextEncoder().encode("Nexus_Security_Salt_v1");

  constructor(
    private sessionStorage: Storage = window.sessionStorage,
    private localStorage: Storage = window.localStorage,
  ) {
    this.tryLoadFromSession();
    this.clearLegacyPasswordCache();
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
    if (options.rememberInSession) {
      this.sessionStorage.setItem(SESSION_PASSWORD_KEY, password);
    } else {
      this.sessionStorage.removeItem(SESSION_PASSWORD_KEY);
    }
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
