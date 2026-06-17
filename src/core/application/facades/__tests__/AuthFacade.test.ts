import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthFacade } from "../AuthFacade";

function createDeps() {
  return {
    gistRepository: {
      setAuthToken: vi.fn(),
      verifyToken: vi.fn(),
    },
    localStoreRepository: {
      getConfig: vi.fn(),
      saveConfig: vi.fn(),
    },
  };
}

describe("AuthFacade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("restoreSession 会恢复本地 token 并标记为待校验状态", async () => {
    const deps = createDeps();
    deps.localStoreRepository.getConfig.mockResolvedValue({
      githubToken: "token-1",
      tokenVerifiedAt: null,
    });

    const facade = new AuthFacade(
      deps.gistRepository,
      deps.localStoreRepository,
    );

    const snapshot = await facade.restoreSession();

    expect(snapshot).toEqual({
      token: "token-1",
      isAuthenticated: true,
      tokenStatus: "unknown",
      tokenVerifiedAt: null,
    });
    expect(deps.gistRepository.setAuthToken).toHaveBeenCalledWith("token-1");
  });

  it("verifyToken 在成功时会更新时间戳并持久化", async () => {
    const deps = createDeps();
    deps.gistRepository.verifyToken.mockResolvedValue(true);

    const facade = new AuthFacade(
      deps.gistRepository,
      deps.localStoreRepository,
    );

    const snapshot = await facade.verifyToken(
      {
        token: "token-1",
        tokenVerifiedAt: null,
      },
      false,
    );

    expect(snapshot.isAuthenticated).toBe(true);
    expect(snapshot.tokenStatus).toBe("valid");
    expect(snapshot.tokenVerifiedAt).toBeTruthy();
    expect(deps.gistRepository.verifyToken).toHaveBeenCalledWith("token-1");
    expect(deps.localStoreRepository.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        githubToken: "token-1",
        tokenVerifiedAt: expect.any(String),
      }),
    );
  });

  it("verifyToken 在最近已校验时跳过远程验证", async () => {
    const deps = createDeps();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));

    const facade = new AuthFacade(
      deps.gistRepository,
      deps.localStoreRepository,
    );

    const snapshot = await facade.verifyToken(
      {
        token: "token-1",
        tokenVerifiedAt: "2026-03-10T00:00:00.000Z",
      },
      false,
    );

    expect(snapshot).toEqual({
      token: "token-1",
      isAuthenticated: true,
      tokenStatus: "valid",
      tokenVerifiedAt: "2026-03-10T00:00:00.000Z",
    });
    expect(deps.gistRepository.verifyToken).not.toHaveBeenCalled();
    expect(deps.localStoreRepository.saveConfig).not.toHaveBeenCalled();
  });

  it("setToken 在校验失败时返回显式错误结果", async () => {
    const deps = createDeps();
    deps.gistRepository.verifyToken.mockResolvedValue(false);

    const facade = new AuthFacade(
      deps.gistRepository,
      deps.localStoreRepository,
    );

    const result = await facade.setToken("bad-token");

    expect(result).toEqual({
      ok: false,
      code: "AUTH_INVALID_TOKEN",
      message: "GitHub Token 无效",
    });
    expect(deps.gistRepository.setAuthToken).toHaveBeenCalledWith(null);
    expect(deps.localStoreRepository.saveConfig).not.toHaveBeenCalled();
  });

  it("verifyToken 在结果过期时不会覆盖本地持久化状态", async () => {
    const deps = createDeps();
    deps.gistRepository.verifyToken.mockResolvedValue(true);
    const onStaleResult = vi.fn();

    const facade = new AuthFacade(
      deps.gistRepository,
      deps.localStoreRepository,
    );

    const snapshot = await facade.verifyToken(
      {
        token: "token-1",
        tokenVerifiedAt: null,
      },
      {
        force: false,
        shouldCommit: () => false,
        onStaleResult,
      },
    );

    expect(snapshot).toEqual({
      token: "token-1",
      isAuthenticated: true,
      tokenStatus: "unknown",
      tokenVerifiedAt: null,
    });
    expect(onStaleResult).toHaveBeenCalledTimes(1);
    expect(deps.localStoreRepository.saveConfig).not.toHaveBeenCalled();
  });
});
