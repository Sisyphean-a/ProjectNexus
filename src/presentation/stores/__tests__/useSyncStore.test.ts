import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createConfig } from "../../../../tests/factories/createConfig";
import { createCategory, createIndex } from "../../../../tests/factories/createIndex";

const mocks = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
  },
  syncFacade: {
    getRateLimit: vi.fn(() => ({
      limit: 5000,
      remaining: 5000,
      resetAt: 0,
    })),
    syncWorkspace: vi.fn(),
    forcePullWorkspace: vi.fn(),
    repairShards: vi.fn(),
  },
  workspaceFacade: {
    updateConfig: vi.fn(),
  },
}));

vi.mock("../../../bootstrap/container", () => ({
  appContainer: mocks,
}));

vi.mock("../../../stores/useAuthStore", () => ({
  useAuthStore: () => mocks.authState,
}));

import { useSelectionStore } from "../useSelectionStore";
import { useSyncStore } from "../useSyncStore";
import { useWorkspaceStore } from "../useWorkspaceStore";

describe("useSyncStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.authState.isAuthenticated = true;
  });

  it("sync(force) 会用 null 作为 lastRemoteUpdatedAt 并写回状态", async () => {
    const syncStore = useSyncStore();
    const workspaceStore = useWorkspaceStore();
    workspaceStore.config = createConfig();
    const initialConfig = workspaceStore.config;
    workspaceStore.remoteUpdatedAt = "2026-01-01T00:00:00.000Z";

    mocks.syncFacade.syncWorkspace.mockResolvedValue({
      synced: true,
      index: createIndex({
        categories: [createCategory({ id: "cat-a", items: [] })],
      }),
      gistUpdatedAt: "2026-02-01T00:00:00.000Z",
      configUpdates: { syncInterval: 60 },
    });

    await syncStore.sync(true);

    expect(mocks.syncFacade.syncWorkspace).toHaveBeenCalledWith(
      initialConfig,
      null,
      { force: true, purgeLocalBeforeSync: false },
    );
    expect(workspaceStore.remoteUpdatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(mocks.workspaceFacade.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ config: initialConfig }),
      { syncInterval: 60 },
    );
  });

  it("forcePullFromRemote 会应用远程 index 并重置选择", async () => {
    const syncStore = useSyncStore();
    const workspaceStore = useWorkspaceStore();
    const selectionStore = useSelectionStore();
    workspaceStore.config = createConfig();
    selectionStore.selectedCategoryId = "local-cat";
    selectionStore.selectedFileId = "local-file";

    mocks.syncFacade.forcePullWorkspace.mockResolvedValue({
      synced: true,
      index: createIndex({
        categories: [createCategory({ id: "remote-cat", items: [] })],
      }),
      gistUpdatedAt: "2026-03-01T00:00:00.000Z",
      configUpdates: null,
    });

    await syncStore.forcePullFromRemote();

    expect(mocks.syncFacade.forcePullWorkspace).toHaveBeenCalledWith(
      workspaceStore.config,
    );
    expect(workspaceStore.index?.categories.map((item) => item.id)).toEqual([
      "remote-cat",
    ]);
    expect(selectionStore.selectedCategoryId).toBe("remote-cat");
    expect(selectionStore.selectedFileId).toBe(null);
  });

  it("未认证时 syncIfStale 直接返回 false", async () => {
    const syncStore = useSyncStore();
    mocks.authState.isAuthenticated = false;

    await expect(syncStore.syncIfStale()).resolves.toBe(false);
    expect(mocks.syncFacade.syncWorkspace).not.toHaveBeenCalled();
  });
});
