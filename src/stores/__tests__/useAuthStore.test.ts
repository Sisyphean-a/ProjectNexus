import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  authFacade: {
    restoreSession: vi.fn(),
    verifyToken: vi.fn(),
    setToken: vi.fn(),
    logout: vi.fn(),
    syncClientToken: vi.fn(),
  },
}));

vi.mock("../../bootstrap/container", () => ({
  authFacade: mocks.authFacade,
}));

import { useAuthStore } from "../useAuthStore";

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.authFacade.restoreSession.mockResolvedValue({
      token: "",
      isAuthenticated: false,
      tokenStatus: "invalid",
      tokenVerifiedAt: null,
    });
    mocks.authFacade.logout.mockResolvedValue({
      token: "",
      isAuthenticated: false,
      tokenStatus: "invalid",
      tokenVerifiedAt: null,
    });
  });

  it("init 会优先恢复本地会话且不阻塞远程校验", async () => {
    const store = useAuthStore();
    mocks.authFacade.restoreSession.mockResolvedValue({
      token: "token-1",
      isAuthenticated: true,
      tokenStatus: "unknown",
      tokenVerifiedAt: null,
    });

    await store.init();

    expect(store.isAuthenticated).toBe(true);
    expect(store.token).toBe("token-1");
    expect(store.tokenStatus).toBe("unknown");
    expect(store.authBootstrapDone).toBe(true);
    expect(store.isChecking).toBe(false);
    expect(mocks.authFacade.restoreSession).toHaveBeenCalledTimes(1);
    expect(mocks.authFacade.verifyToken).not.toHaveBeenCalled();
  });

  it("verifyTokenInBackground 在成功时会更新时间戳并持久化", async () => {
    const store = useAuthStore();
    mocks.authFacade.restoreSession.mockResolvedValue({
      token: "token-1",
      isAuthenticated: true,
      tokenStatus: "unknown",
      tokenVerifiedAt: null,
    });
    mocks.authFacade.verifyToken.mockResolvedValue({
      token: "token-1",
      isAuthenticated: true,
      tokenStatus: "valid",
      tokenVerifiedAt: "2026-02-14T00:00:00.000Z",
    });

    await store.init();
    await store.verifyTokenInBackground();

    expect(mocks.authFacade.verifyToken).toHaveBeenCalledWith({
      token: "token-1",
      tokenVerifiedAt: null,
    }, {
      force: false,
      shouldCommit: expect.any(Function),
      onStaleResult: expect.any(Function),
    });
    expect(store.isAuthenticated).toBe(true);
    expect(store.tokenStatus).toBe("valid");
    expect(store.tokenVerifiedAt).toBe("2026-02-14T00:00:00.000Z");
  });

  it("verifyTokenInBackground 会把当前快照交给 facade 处理", async () => {
    const store = useAuthStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T00:00:00.000Z"));

    mocks.authFacade.restoreSession.mockResolvedValue({
      token: "token-1",
      isAuthenticated: true,
      tokenStatus: "unknown",
      tokenVerifiedAt: "2026-02-14T00:00:00.000Z",
    });
    mocks.authFacade.verifyToken.mockResolvedValue({
      token: "token-1",
      isAuthenticated: true,
      tokenStatus: "valid",
      tokenVerifiedAt: "2026-02-14T00:00:00.000Z",
    });

    await store.init();
    await store.verifyTokenInBackground();

    expect(store.tokenStatus).toBe("valid");
    expect(mocks.authFacade.verifyToken).toHaveBeenCalledWith({
      token: "token-1",
      tokenVerifiedAt: "2026-02-14T00:00:00.000Z",
    }, {
      force: false,
      shouldCommit: expect.any(Function),
      onStaleResult: expect.any(Function),
    });
  });

  it("setToken 在校验失败时返回 false", async () => {
    const store = useAuthStore();
    mocks.authFacade.setToken.mockResolvedValue({
      ok: false,
      code: "AUTH_INVALID_TOKEN",
      message: "GitHub Token 无效",
    });

    const result = await store.setToken("bad-token");

    expect(result).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(store.tokenStatus).toBe("invalid");
  });

  it("logout 会清空本地 token 并更新存储", () => {
    const store = useAuthStore();
    store.token = "existing-token";
    store.isAuthenticated = true;

    store.logout();

    expect(store.token).toBe("");
    expect(store.isAuthenticated).toBe(false);
    expect(store.tokenStatus).toBe("invalid");
    expect(mocks.authFacade.logout).toHaveBeenCalledTimes(1);
  });
});
