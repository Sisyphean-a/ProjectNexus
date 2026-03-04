import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createConfig } from "../../../tests/factories/createConfig";
import { DECRYPTION_PENDING_PREFIX } from "../../core/application/services/SyncService";
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
  cryptoProvider: {
    hasPassword: vi.fn(() => true),
  },
  fileRepository: {
    get: vi.fn(),
    delete: vi.fn(),
    save: vi.fn(),
    clearAll: vi.fn(),
  },
  localStoreRepository: {
    getConfig: vi.fn(),
    getIndex: vi.fn(),
    saveConfig: vi.fn(),
    saveIndex: vi.fn(),
    clearIndexAndCaches: vi.fn(),
  },
  gistRepository: {
    rateLimit: {
      limit: 5000,
      remaining: 5000,
      resetAt: 0,
    },
    fetchGist: vi.fn(),
    findNexusGist: vi.fn(),
    getGistHistory: vi.fn(),
    getGistVersion: vi.fn(),
  },
  localHistoryRepository: {
    addSnapshot: vi.fn(),
    pruneHistory: vi.fn(),
    deleteFileHistory: vi.fn(),
    getHistory: vi.fn(),
    clearAll: vi.fn(),
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
  cryptoProvider: mocks.cryptoProvider,
}));

vi.mock("../useAuthStore", () => ({
  useAuthStore: () => mocks.authState,
}));

import { useNexusStore } from "../useNexusStore";

describe("useNexusStore behaviors", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.authState.isAuthenticated = true;
    mocks.cryptoProvider.hasPassword.mockReturnValue(true);

    mocks.localStoreRepository.getConfig.mockResolvedValue(createConfig());
    mocks.localStoreRepository.getIndex.mockResolvedValue(
      createIndex({
        categories: [createCategory({ items: [createIndexItem()] })],
      }),
    );

    mocks.localHistoryRepository.addSnapshot.mockResolvedValue(1);
    mocks.localHistoryRepository.pruneHistory.mockResolvedValue(undefined);
    mocks.localHistoryRepository.clearAll.mockResolvedValue(undefined);
    mocks.fileRepository.clearAll.mockResolvedValue(undefined);
    mocks.localStoreRepository.clearIndexAndCaches.mockResolvedValue(undefined);
    mocks.gistRepository.fetchGist.mockResolvedValue({
      id: "root-gist",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    mocks.gistRepository.findNexusGist.mockResolvedValue("root-gist");
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

  it("forcePullFromRemote 会先清空本地数据再拉取远程覆盖", async () => {
    const store = useNexusStore();
    const remoteIndex = createIndex({
      categories: [createCategory({ id: "remote-cat", items: [] })],
    });
    store.config = createConfig();
    store.index = createIndex({
      categories: [createCategory({ id: "local-cat", items: [createIndexItem()] })],
    });
    store.selectedCategoryId = "local-cat";
    store.selectedFileId = "local-file";
    store.remoteUpdatedAt = "2026-01-01T00:00:00.000Z";

    mocks.syncService.syncDown.mockResolvedValue({
      synced: true,
      index: remoteIndex,
      gistUpdatedAt: "2026-01-03T00:00:00.000Z",
    });

    await store.forcePullFromRemote();

    expect(mocks.fileRepository.clearAll).toHaveBeenCalledTimes(1);
    expect(mocks.localHistoryRepository.clearAll).toHaveBeenCalledTimes(1);
    expect(mocks.localStoreRepository.clearIndexAndCaches).toHaveBeenCalledTimes(1);
    expect(mocks.syncService.syncDown).toHaveBeenCalledWith(store.config, null);
    expect(store.index?.categories.map((cat) => cat.id)).toEqual(["remote-cat"]);
    expect(store.selectedCategoryId).toBe("remote-cat");
    expect(store.selectedFileId).toBe(null);
    expect(store.remoteUpdatedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(store.lastSyncedAt).toBeTruthy();
  });

  it("forcePullFromRemote 在配置 gist 404 时会先重定位再清空本地", async () => {
    const store = useNexusStore();
    const remoteIndex = createIndex({
      categories: [createCategory({ id: "remote-cat", items: [] })],
    });
    store.config = createConfig({
      gistId: "missing-root",
      rootGistId: "missing-root",
    });

    mocks.gistRepository.fetchGist.mockRejectedValueOnce({
      status: 404,
      message: "Not Found",
    });
    mocks.gistRepository.findNexusGist.mockResolvedValueOnce("new-root");
    mocks.syncService.syncDown.mockResolvedValue({
      synced: true,
      index: remoteIndex,
      gistUpdatedAt: "2026-01-03T00:00:00.000Z",
    });

    await store.forcePullFromRemote();

    expect(mocks.localStoreRepository.saveConfig).toHaveBeenCalledWith({
      rootGistId: "new-root",
      gistId: "new-root",
    });
    expect(mocks.syncService.syncDown).toHaveBeenCalledWith(
      expect.objectContaining({
        rootGistId: "new-root",
        gistId: "new-root",
      }),
      null,
    );
    expect(
      mocks.gistRepository.fetchGist.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.fileRepository.clearAll.mock.invocationCallOrder[0]);
  });

  it("forcePullFromRemote 在远程不可达时不会清空本地", async () => {
    const store = useNexusStore();
    store.config = createConfig({
      gistId: "missing-root",
      rootGistId: "missing-root",
    });

    mocks.gistRepository.fetchGist.mockRejectedValueOnce({
      status: 404,
      message: "Not Found",
    });
    mocks.gistRepository.findNexusGist.mockResolvedValueOnce(null);

    await expect(store.forcePullFromRemote()).rejects.toThrow("未找到");
    expect(mocks.fileRepository.clearAll).not.toHaveBeenCalled();
    expect(mocks.localHistoryRepository.clearAll).not.toHaveBeenCalled();
    expect(mocks.localStoreRepository.clearIndexAndCaches).not.toHaveBeenCalled();
  });

  it("init 会加载本地 index 并默认选中首分类", async () => {
    const store = useNexusStore();
    mocks.localStoreRepository.getIndex.mockResolvedValue(
      createIndex({
        categories: [
          createCategory({ id: "cat-a", items: [] }),
          createCategory({ id: "cat-b", items: [] }),
        ],
      }),
    );

    await store.init();

    expect(store.index?.categories.map((c) => c.id)).toEqual(["cat-a", "cat-b"]);
    expect(store.selectedCategoryId).toBe("cat-a");
  });

  it("getFileContent 在未设置保险库密码时隐藏安全文件明文", async () => {
    const store = useNexusStore();
    mocks.cryptoProvider.hasPassword.mockReturnValue(false);
    mocks.fileRepository.get.mockResolvedValue({
      id: "file-secure",
      content: "plain-secret",
      isSecure: true,
      isDirty: false,
    });

    const content = await store.getFileContent("file-secure");

    expect(content).toBe(DECRYPTION_PENDING_PREFIX);
    expect(mocks.fileRepository.delete).toHaveBeenCalledWith("file-secure");
  });

  it("syncIfStale 在阈值内跳过远程同步", async () => {
    const store = useNexusStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T00:02:00.000Z"));
    store.lastSyncedAt = "2026-02-14T00:00:00.000Z";

    const triggered = await store.syncIfStale(5 * 60 * 1000);

    expect(triggered).toBe(false);
    expect(mocks.syncService.syncDown).not.toHaveBeenCalled();
  });

  it("syncIfStale 在超过阈值后触发同步", async () => {
    const store = useNexusStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T00:10:00.000Z"));
    store.lastSyncedAt = "2026-02-14T00:00:00.000Z";

    mocks.syncService.syncDown.mockResolvedValue({
      synced: false,
      index: null,
    });

    const triggered = await store.syncIfStale(5 * 60 * 1000);

    expect(triggered).toBe(true);
    expect(mocks.syncService.syncDown).toHaveBeenCalledTimes(1);
    expect(store.lastSyncAttemptAt).toBeTruthy();
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
