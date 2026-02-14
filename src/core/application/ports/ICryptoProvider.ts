export interface SetPasswordOptions {
  rememberInSession?: boolean;
}

export interface ICryptoProvider {
  /**
   * Encrypts the given plain text.
   * @param text Plain text to encrypt
   * @returns Cipher text (e.g. base64 encoded with IV)
   */
  encrypt(text: string): Promise<string>;

  /**
   * Decrypts the given cipher text.
   * @param text Cipher text to decrypt
   * @returns Original plain text
   */
  decrypt(text: string): Promise<string>;

  /**
   * Sets the password used for key derivation.
   * @param password User provided password
   */
  setPassword(password: string, options?: SetPasswordOptions): Promise<void>;

  /**
   * Checks if a password has been set/configured.
   */
  hasPassword(): boolean;

  /**
   * Clears the current key from memory and any session persistence.
   */
  clearPassword(): void;
}
