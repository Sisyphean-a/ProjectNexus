import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  gistRepository: {
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
  });

  it("init 在 token 有效时会完成认证", async () => {
    const store = useAuthStore();
    mocks.localStoreRepository.getConfig.mockResolvedValue({
      githubToken: "token-1",
    });
    mocks.gistRepository.verifyToken.mockResolvedValue(true);

    await store.init();

    expect(store.isAuthenticated).toBe(true);
    expect(store.token).toBe("token-1");
    expect(store.isChecking).toBe(false);
  });

  it("setToken 在校验失败时返回 false", async () => {
    const store = useAuthStore();
    mocks.gistRepository.verifyToken.mockResolvedValue(false);

    const result = await store.setToken("bad-token");

    expect(result).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(mocks.localStoreRepository.saveConfig).not.toHaveBeenCalled();
  });

  it("logout 会清空本地 token 并更新存储", () => {
    const store = useAuthStore();
    store.token = "existing-token";
    store.isAuthenticated = true;

    store.logout();

    expect(store.token).toBe("");
    expect(store.isAuthenticated).toBe(false);
    expect(mocks.localStoreRepository.saveConfig).toHaveBeenCalledWith({
      githubToken: "",
    });
  });
});
