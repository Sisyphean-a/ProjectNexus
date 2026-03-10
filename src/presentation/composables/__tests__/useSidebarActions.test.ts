import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSidebarActions } from "../useSidebarActions";

describe("createSidebarActions", () => {
  it("saveVaultPassword 在存在工作区时会刷新 secure cache 并强制同步", async () => {
    const setPassword = vi.fn().mockResolvedValue(undefined);
    const resetSecureCache = vi.fn().mockResolvedValue(undefined);
    const sync = vi.fn().mockResolvedValue(undefined);

    const actions = createSidebarActions({
      workspaceIndex: ref({ categories: [], updated_at: "2026-01-01T00:00:00.000Z" }),
      setPassword,
      resetSecureCache,
      sync,
    });

    await actions.saveVaultPassword("secret", "session");

    expect(setPassword).toHaveBeenCalledWith("secret", {
      rememberMode: "session",
    });
    expect(resetSecureCache).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(true);
  });
});
