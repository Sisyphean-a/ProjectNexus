import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createConfig } from "../../../tests/factories/createConfig";
import {
  createCategory,
  createIndex,
  createIndexItem,
} from "../../../tests/factories/createIndex";

const mocks = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
  },
  syncService: {
    pushIndex: vi.fn(),
    deleteRemoteFile: vi.fn(),
    syncDown: vi.fn(),
    initializeNexus: vi.fn(),
    repairShards: vi.fn(),
  },
  fileService: {
    updateContent: vi.fn(),
    createFile: vi.fn(),
    changeLanguage: vi.fn(),
    updateFileMetadata: vi.fn(),
    deleteFile: vi.fn(),
  },
  fileRepository: {
    get: vi.fn(),
    delete: vi.fn(),
    save: vi.fn(),
  },
  localStoreRepository: {
    getConfig: vi.fn(),
    getIndex: vi.fn(),
    saveConfig: vi.fn(),
    saveIndex: vi.fn(),
  },
  gistRepository: {
    rateLimit: {
      limit: 5000,
      remaining: 5000,
      resetAt: 0,
    },
    getGistHistory: vi.fn(),
    getGistVersion: vi.fn(),
  },
  localHistoryRepository: {
    addSnapshot: vi.fn(),
    pruneHistory: vi.fn(),
    deleteFileHistory: vi.fn(),
    getHistory: vi.fn(),
  },
}));

vi.mock("../../infrastructure", () => ({
  fileRepository: mocks.fileRepository,
  localStoreRepository: mocks.localStoreRepository,
  gistRepository: mocks.gistRepository,
  localHistoryRepository: mocks.localHistoryRepository,
}));

vi.mock("../../services", () => ({
  syncService: mocks.syncService,
  fileService: mocks.fileService,
}));

vi.mock("../useAuthStore", () => ({
  useAuthStore: () => mocks.authState,
}));

import { useNexusStore } from "../useNexusStore";

describe("useNexusStore behaviors", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.authState.isAuthenticated = true;

    mocks.localStoreRepository.getConfig.mockResolvedValue(createConfig());
    mocks.localStoreRepository.getIndex.mockResolvedValue(
      createIndex({
        categories: [createCategory({ items: [createIndexItem()] })],
      }),
    );

    mocks.localHistoryRepository.addSnapshot.mockResolvedValue(1);
    mocks.localHistoryRepository.pruneHistory.mockResolvedValue(undefined);
    mocks.gistRepository.getGistHistory.mockResolvedValue([]);
    mocks.gistRepository.getGistVersion.mockResolvedValue({});
  });

  it("sync(force) 会以 null 作为 lastRemoteUpdatedAt", async () => {
    const store = useNexusStore();
    store.config = createConfig();
    store.remoteUpdatedAt = "2026-01-01T00:00:00.000Z";

    mocks.syncService.syncDown.mockResolvedValue({
      synced: false,
      index: null,
    });

    await store.sync(true);

    expect(mocks.syncService.syncDown).toHaveBeenCalledWith(store.config, null);
  });

  it("sync 成功后会更新 index、远端时间并选择首分类", async () => {
    const store = useNexusStore();
    const nextIndex = createIndex({
      categories: [
        createCategory({ id: "cat-a", items: [] }),
        createCategory({ id: "cat-b", name: "B", items: [] }),
      ],
    });

    mocks.syncService.syncDown.mockResolvedValue({
      synced: true,
      index: nextIndex,
      gistUpdatedAt: "2026-01-03T00:00:00.000Z",
      configUpdates: { syncInterval: 60 },
    });

    await store.sync();

    expect(store.index?.categories.map((c) => c.id)).toEqual(["cat-a", "cat-b"]);
    expect(store.remoteUpdatedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(store.selectedCategoryId).toBe("cat-a");
    expect(mocks.localStoreRepository.saveConfig).toHaveBeenCalledWith({
      syncInterval: 60,
    });
  });

  it("sync 在未认证时直接拒绝", async () => {
    const store = useNexusStore();
    mocks.authState.isAuthenticated = false;

    await expect(store.sync()).rejects.toThrow("未认证");
    expect(mocks.syncService.syncDown).not.toHaveBeenCalled();
  });

  it("saveFileContent 会更新远端时间并记录 manual 快照", async () => {
    const store = useNexusStore();
    store.config = createConfig();
    store.index = createIndex();
    store.remoteUpdatedAt = "2026-01-01T00:00:00.000Z";

    mocks.fileService.updateContent.mockResolvedValue({
      newRemoteTime: "2026-01-02T00:00:00.000Z",
    });

    await store.saveFileContent("file-1", "updated-content");

    expect(mocks.fileService.updateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: store.config,
        index: store.index,
        lastRemoteUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
      "file-1",
      "updated-content",
    );
    expect(mocks.localHistoryRepository.addSnapshot).toHaveBeenCalledWith(
      "file-1",
      "updated-content",
      "manual",
    );
    expect(mocks.localHistoryRepository.pruneHistory).toHaveBeenCalledWith("file-1");
    expect(store.remoteUpdatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(store.lastSyncedAt).toBeTruthy();
  });

  it("saveFileContent 在历史仓储失败时不中断主流程", async () => {
    const store = useNexusStore();
    store.config = createConfig();
    store.index = createIndex();
    mocks.fileService.updateContent.mockResolvedValue({
      newRemoteTime: "2026-01-02T00:00:00.000Z",
    });
    mocks.localHistoryRepository.addSnapshot.mockRejectedValue(
      new Error("history write failed"),
    );

    await expect(
      store.saveFileContent("file-1", "updated-content"),
    ).resolves.toBeUndefined();
  });

  it("restoreFileContent 会记录 restore 快照", async () => {
    const store = useNexusStore();
    store.config = createConfig();
    store.index = createIndex();

    mocks.fileService.updateContent.mockResolvedValue({
      newRemoteTime: "2026-02-01T00:00:00.000Z",
    });

    await store.restoreFileContent("file-1", "restored-content");

    expect(mocks.localHistoryRepository.addSnapshot).toHaveBeenCalledWith(
      "file-1",
      "restored-content",
      "restore",
      "Restored from history",
    );
    expect(store.remoteUpdatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("importRemoteHistory 只导入目标文件存在的历史版本", async () => {
    const store = useNexusStore();
    store.config = createConfig();

    mocks.gistRepository.getGistHistory.mockResolvedValue([
      {
        version: "abc1234",
        committedAt: "2026-01-01T00:00:00.000Z",
        changeStatus: { additions: 1, deletions: 0, total: 1 },
      },
      {
        version: "def5678",
        committedAt: "2026-01-02T00:00:00.000Z",
        changeStatus: { additions: 1, deletions: 0, total: 1 },
      },
    ]);
    mocks.gistRepository.getGistVersion
      .mockResolvedValueOnce({
        "file-1.yaml": {
          content: "v1",
        },
      })
      .mockResolvedValueOnce({});

    const imported = await store.importRemoteHistory("file-1", "file-1.yaml");

    expect(imported).toBe(1);
    expect(mocks.localHistoryRepository.addSnapshot).toHaveBeenCalledWith(
      "file-1",
      "v1",
      "sync",
      "Imported from Gist (abc1234)",
      "2026-01-01T00:00:00.000Z",
    );
  });
});
