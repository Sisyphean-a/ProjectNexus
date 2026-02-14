import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  gistRepository: {
    setAuthToken: vi.fn(),
    verifyToken: vi.fn(),
  },
  localStoreRepository: {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
  },
}));

vi.mock("../../infrastructure", () => ({
  gistRepository: mocks.gistRepository,
  localStoreRepository: mocks.localStoreRepository,
}));

import { useAuthStore } from "../useAuthStore";

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("init 会优先恢复本地会话且不阻塞远程校验", async () => {
    const store = useAuthStore();
    mocks.localStoreRepository.getConfig.mockResolvedValue({
      githubToken: "token-1",
      tokenVerifiedAt: null,
    });

    await store.init();

    expect(store.isAuthenticated).toBe(true);
    expect(store.token).toBe("token-1");
    expect(store.tokenStatus).toBe("unknown");
    expect(store.authBootstrapDone).toBe(true);
    expect(store.isChecking).toBe(false);
    expect(mocks.gistRepository.setAuthToken).toHaveBeenCalledWith("token-1");
    expect(mocks.gistRepository.verifyToken).not.toHaveBeenCalled();
  });

  it("verifyTokenInBackground 在成功时会更新时间戳并持久化", async () => {
    const store = useAuthStore();
    mocks.localStoreRepository.getConfig.mockResolvedValue({
      githubToken: "token-1",
      tokenVerifiedAt: null,
    });
    mocks.gistRepository.verifyToken.mockResolvedValue(true);

    await store.init();
    await store.verifyTokenInBackground();

    expect(mocks.gistRepository.verifyToken).toHaveBeenCalledWith("token-1");
    expect(store.isAuthenticated).toBe(true);
    expect(store.tokenStatus).toBe("valid");
    expect(store.tokenVerifiedAt).toBeTruthy();
    expect(mocks.localStoreRepository.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        githubToken: "token-1",
        tokenVerifiedAt: expect.any(String),
      }),
    );
  });

  it("verifyTokenInBackground 在未过期时跳过远程请求", async () => {
    const store = useAuthStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T00:00:00.000Z"));

    mocks.localStoreRepository.getConfig.mockResolvedValue({
      githubToken: "token-1",
      tokenVerifiedAt: "2026-02-14T00:00:00.000Z",
    });

    await store.init();
    await store.verifyTokenInBackground();

    expect(store.tokenStatus).toBe("valid");
    expect(mocks.gistRepository.verifyToken).not.toHaveBeenCalled();
  });

  it("setToken 在校验失败时返回 false", async () => {
    const store = useAuthStore();
    mocks.gistRepository.verifyToken.mockResolvedValue(false);

    const result = await store.setToken("bad-token");

    expect(result).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(store.tokenStatus).toBe("invalid");
    expect(mocks.localStoreRepository.saveConfig).not.toHaveBeenCalled();
  });

  it("logout 会清空本地 token 并更新存储", () => {
    const store = useAuthStore();
    store.token = "existing-token";
    store.isAuthenticated = true;

    store.logout();

    expect(store.token).toBe("");
    expect(store.isAuthenticated).toBe(false);
    expect(store.tokenStatus).toBe("invalid");
    expect(mocks.gistRepository.setAuthToken).toHaveBeenCalledWith(null);
    expect(mocks.localStoreRepository.saveConfig).toHaveBeenCalledWith({
      githubToken: "",
      tokenVerifiedAt: null,
    });
  });
});
