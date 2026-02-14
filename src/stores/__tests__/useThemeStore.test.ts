import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  localStoreRepository: {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
  },
}));

vi.mock("../../infrastructure", () => ({
  localStoreRepository: mocks.localStoreRepository,
}));

import { useThemeStore } from "../useThemeStore";

describe("useThemeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.localStoreRepository.getConfig.mockResolvedValue({
      theme: "dark",
    });
  });

  it("init 会读取配置并应用系统主题监听", async () => {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: (_event: string, cb: (e: { matches: boolean }) => void) =>
          listeners.push(cb),
      }),
    );

    const store = useThemeStore();
    await store.init();

    expect(store.mode).toBe("dark");
    expect(store.effectiveTheme).toBe("dark");
    expect(store.isDark).toBe(true);

    listeners[0]({ matches: true });
    expect(store.isDark).toBe(true);
  });

  it("setMode 会持久化到本地配置", async () => {
    const store = useThemeStore();

    await store.setMode("light");

    expect(store.mode).toBe("light");
    expect(mocks.localStoreRepository.saveConfig).toHaveBeenCalledWith({
      theme: "light",
    });
  });

  it("toggleTheme 会按 light -> dark -> auto 循环", async () => {
    const store = useThemeStore();
    store.mode = "light";

    await store.toggleTheme();
    expect(store.mode).toBe("dark");

    await store.toggleTheme();
    expect(store.mode).toBe("auto");

    await store.toggleTheme();
    expect(store.mode).toBe("light");
  });
});
