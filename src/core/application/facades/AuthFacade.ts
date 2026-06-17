import type { ILocalStore } from "../ports/ILocalStore";
import type { AppResult } from "../dto/AppResult";

export type TokenStatus = "unknown" | "valid" | "invalid";

export interface AuthSessionSnapshot {
  token: string;
  isAuthenticated: boolean;
  tokenStatus: TokenStatus;
  tokenVerifiedAt: string | null;
}

interface AuthGistGateway {
  setAuthToken(token: string | null): void;
  verifyToken(token: string): Promise<boolean>;
}

type AuthStoreGateway = Pick<ILocalStore, "getConfig" | "saveConfig">;

interface VerifyTokenOptions {
  force?: boolean;
  shouldCommit?: () => boolean;
  onStaleResult?: () => void;
}

export const TOKEN_VERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function createSignedOutAuthState(): AuthSessionSnapshot {
  return {
    token: "",
    isAuthenticated: false,
    tokenStatus: "invalid",
    tokenVerifiedAt: null,
  };
}

function createPendingAuthState(token: string, tokenVerifiedAt: string | null): AuthSessionSnapshot {
  return {
    token,
    isAuthenticated: true,
    tokenStatus: "unknown",
    tokenVerifiedAt,
  };
}

function createVerifiedAuthState(
  token: string,
  tokenVerifiedAt: string | null,
): AuthSessionSnapshot {
  return {
    token,
    isAuthenticated: true,
    tokenStatus: "valid",
    tokenVerifiedAt,
  };
}

function parseIsoTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class AuthFacade {
  constructor(
    private gistRepository: AuthGistGateway,
    private localStoreRepository: AuthStoreGateway,
  ) {}

  async restoreSession(): Promise<AuthSessionSnapshot> {
    const config = await this.localStoreRepository.getConfig();
    const token = config.githubToken || "";
    const tokenVerifiedAt = config.tokenVerifiedAt || null;

    if (!token) {
      this.gistRepository.setAuthToken(null);
      return createSignedOutAuthState();
    }

    this.gistRepository.setAuthToken(token);
    return createPendingAuthState(token, tokenVerifiedAt);
  }

  async verifyToken(
    state: Pick<AuthSessionSnapshot, "token" | "tokenVerifiedAt">,
    options: VerifyTokenOptions | boolean = false,
  ): Promise<AuthSessionSnapshot> {
    const normalizedOptions: VerifyTokenOptions =
      typeof options === "boolean" ? { force: options } : options;

    if (!state.token) {
      this.gistRepository.setAuthToken(null);
      return createSignedOutAuthState();
    }

    if (!this.shouldVerify(state, normalizedOptions.force)) {
      return createVerifiedAuthState(state.token, state.tokenVerifiedAt);
    }

    const valid = await this.gistRepository.verifyToken(state.token);
    const shouldCommit = normalizedOptions.shouldCommit ?? (() => true);
    if (!shouldCommit()) {
      normalizedOptions.onStaleResult?.();
      return createPendingAuthState(state.token, state.tokenVerifiedAt);
    }

    if (!valid) {
      this.gistRepository.setAuthToken(null);
      await this.localStoreRepository.saveConfig({
        githubToken: "",
        tokenVerifiedAt: null,
      });
      return createSignedOutAuthState();
    }

    this.gistRepository.setAuthToken(state.token);
    const verifiedAt = new Date().toISOString();
    await this.localStoreRepository.saveConfig({
      githubToken: state.token,
      tokenVerifiedAt: verifiedAt,
    });
    return createVerifiedAuthState(state.token, verifiedAt);
  }

  async setToken(token: string): Promise<AppResult<AuthSessionSnapshot>> {
    const valid = await this.gistRepository.verifyToken(token);
    if (!valid) {
      this.gistRepository.setAuthToken(null);
      return {
        ok: false,
        code: "AUTH_INVALID_TOKEN",
        message: "GitHub Token 无效",
      };
    }

    this.gistRepository.setAuthToken(token);
    const verifiedAt = new Date().toISOString();
    await this.localStoreRepository.saveConfig({
      githubToken: token,
      tokenVerifiedAt: verifiedAt,
    });

    return {
      ok: true,
      data: createVerifiedAuthState(token, verifiedAt),
    };
  }

  async logout(): Promise<AuthSessionSnapshot> {
    this.gistRepository.setAuthToken(null);
    await this.localStoreRepository.saveConfig({
      githubToken: "",
      tokenVerifiedAt: null,
    });
    return createSignedOutAuthState();
  }

  syncClientToken(token: string | null): void {
    this.gistRepository.setAuthToken(token);
  }

  private shouldVerify(
    state: Pick<AuthSessionSnapshot, "token" | "tokenVerifiedAt">,
    force = false,
  ): boolean {
    if (force) {
      return true;
    }
    if (!state.token) {
      return false;
    }

    const lastVerifiedMs = parseIsoTime(state.tokenVerifiedAt);
    if (!lastVerifiedMs) {
      return true;
    }

    return Date.now() - lastVerifiedMs >= TOKEN_VERIFY_INTERVAL_MS;
  }
}
