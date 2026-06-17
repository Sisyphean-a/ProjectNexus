import { describe, expect, it } from "vitest";
import { useSidebarActions } from "../useSidebarActions";

describe("useSidebarActions", () => {
  it("读取并持久化保险库记住策略", async () => {
    window.localStorage.setItem("nexus_vault_remember_mode", "trustedDevice");

    const actions = useSidebarActions({
      workspaceStore: {
        index: null,
        isLoading: false,
      },
      selectionStore: {
        selectCategory() {},
        selectFile() {},
      },
      syncStore: {
        apiRateLimit: null,
      },
      vaultStore: {},
      message: {
        success() {},
        error() {},
        warning() {},
        loading() {
          return { destroy() {} };
        },
      },
      dialog: {
        warning() {},
        info() {},
      },
    });

    expect(actions.rememberVaultMode.value).toBe("trustedDevice");

    actions.rememberVaultMode.value = "memory";
    await Promise.resolve();

    expect(window.localStorage.getItem("nexus_vault_remember_mode")).toBe("memory");
  });
});
