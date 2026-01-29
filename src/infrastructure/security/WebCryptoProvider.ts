import { ICryptoProvider } from "../../core/application/ports/ICryptoProvider";

export class WebCryptoProvider implements ICryptoProvider {
  private key: CryptoKey | null = null;
  private readonly SALT = new TextEncoder().encode("Nexus_Security_Salt_v1"); // Fixed salt for simplicity in this context, or random per user if we stored it.
  // For "device authorized" logic, we settle on a fixed salt or stored salt. 
  // Let's use a fixed salt for now to ensure we can regenerate the key easily from just the password.

  constructor(private storage: Storage = window.localStorage) {
    this.tryLoadFromStorage();
  }

  private async tryLoadFromStorage() {
    const savedPwd = this.storage.getItem("nexus_vault_password");
    if (savedPwd) {
      await this.setPassword(savedPwd);
    }
  }

  hasPassword(): boolean {
    return !!this.key;
  }

  async setPassword(password: string): Promise<void> {
    this.storage.setItem("nexus_vault_password", password);
    this.key = await this.deriveKey(password);
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
        // Fallback: maybe it's not encrypted or old format? 
        // For now, assume strict format. If fails, return original text or throw?
        // Let's throw to be safe, or return raw if it doesn't look like our format.
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
    } catch (e) {
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
