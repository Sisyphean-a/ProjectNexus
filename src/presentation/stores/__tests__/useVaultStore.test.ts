import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createConfig } from "../../../../tests/factories/createConfig";
import { createIndex } from "../../../../tests/factories/createIndex";

const mocks = vi.hoisted(() => ({
  vaultFacade: {
    hasPassword: vi.fn(() => false),
    getFileContent: vi.fn(),
    updateFileSecureStatus: vi.fn(),
    resetSecureCache: vi.fn(),
    setPassword: vi.fn(),
  },
}));

vi.mock("../../../bootstrap/container", () => ({
  appContainer: mocks,
}));

import { useVaultStore } from "../useVaultStore";
import { useWorkspaceStore } from "../useWorkspaceStore";

describe("useVaultStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("getFileContent 直接委托给 vault facade", async () => {
    const vaultStore = useVaultStore();
    mocks.vaultFacade.getFileContent.mockResolvedValue("__pending__");

    await expect(vaultStore.getFileContent("file-1")).resolves.toBe(
      "__pending__",
    );
    expect(mocks.vaultFacade.getFileContent).toHaveBeenCalledWith("file-1");
  });

  it("updateFileSecureStatus 会写回新的远端时间", async () => {
    const vaultStore = useVaultStore();
    const workspaceStore = useWorkspaceStore();
    workspaceStore.config = createConfig();
    workspaceStore.index = createIndex();
    workspaceStore.remoteUpdatedAt = "2026-01-01T00:00:00.000Z";

    mocks.vaultFacade.updateFileSecureStatus.mockResolvedValue({
      newRemoteTime: "2026-02-01T00:00:00.000Z",
    });

    await vaultStore.updateFileSecureStatus("file-1", true);

    expect(mocks.vaultFacade.updateFileSecureStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        config: workspaceStore.config,
        index: workspaceStore.index,
        lastRemoteUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
      "file-1",
      true,
    );
    expect(workspaceStore.remoteUpdatedAt).toBe("2026-02-01T00:00:00.000Z");
  });
});
