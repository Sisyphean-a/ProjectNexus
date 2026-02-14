import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { NexusConfig, NexusIndex } from "../../core/domain/entities/types";

const mocks = vi.hoisted(() => {
  return {
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
  };
});

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
  useAuthStore: () => ({
    isAuthenticated: true,
  }),
}));

import { useNexusStore } from "../useNexusStore";

function createConfig(): NexusConfig {
  return {
    githubToken: "token",
    gistId: "root-gist",
    rootGistId: "root-gist",
    legacyGistId: null,
    schemaVersion: 2,
    syncInterval: 30,
    theme: "auto",
  };
}

function createIndex(): NexusIndex {
  return {
    version: 2,
    updated_at: "2026-01-01T00:00:00.000Z",
    shards: [
      {
        id: "shard-1",
        gistId: "shard-gist-1",
        categoryId: "cat-a",
        categoryName: "Cat A",
        part: 1,
        kind: "category",
        fileCount: 2,
        totalBytes: 20,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    categories: [
      {
        id: "cat-a",
        name: "Cat A",
        items: [
          {
            id: "file-1",
            title: "File 1",
            gist_file: "file-1.yaml",
            language: "yaml",
            storage: {
              shardId: "shard-1",
              gistId: "shard-gist-1",
              gist_file: "file-1.yaml",
            },
          },
          {
            id: "file-2",
            title: "File 2",
            gist_file: "file-2.yaml",
            language: "yaml",
            storage: {
              shardId: "shard-1",
              gistId: "shard-gist-1",
              gist_file: "file-2.yaml",
            },
          },
        ],
      },
      {
        id: "cat-b",
        name: "Cat B",
        items: [],
      },
    ],
  };
}

describe("useNexusStore.deleteCategory", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.syncService.pushIndex.mockResolvedValue("2026-01-02T00:00:00.000Z");
    mocks.fileRepository.delete.mockResolvedValue(undefined);
    mocks.localHistoryRepository.deleteFileHistory.mockResolvedValue(undefined);
  });

  it("在部分文件清理失败时返回失败列表并完成删除", async () => {
    const store = useNexusStore();
    store.config = createConfig();
    store.index = createIndex();
    store.selectedCategoryId = "cat-a";

    mocks.syncService.deleteRemoteFile
      .mockResolvedValueOnce("2026-01-02T00:00:00.000Z")
      .mockRejectedValueOnce(new Error("remote failure"));

    const result = await store.deleteCategory("cat-a");

    expect(result.deletedFiles).toBe(1);
    expect(result.failedFiles).toEqual(["file-2.yaml"]);
    expect(store.selectedCategoryId).toBe("cat-b");
    expect(store.index?.categories.map((c) => c.id)).toEqual(["cat-b"]);
    expect(mocks.syncService.pushIndex).toHaveBeenCalledTimes(2);
    expect(mocks.fileRepository.delete).toHaveBeenCalledTimes(2);
    expect(mocks.localHistoryRepository.deleteFileHistory).toHaveBeenCalledTimes(2);
  });

  it("在全部清理成功时返回完整删除结果", async () => {
    const store = useNexusStore();
    store.config = createConfig();
    store.index = createIndex();
    store.selectedCategoryId = "cat-a";

    mocks.syncService.deleteRemoteFile.mockResolvedValue(
      "2026-01-02T00:00:00.000Z",
    );

    const result = await store.deleteCategory("cat-a");

    expect(result.deletedFiles).toBe(2);
    expect(result.failedFiles).toEqual([]);
    expect(store.index?.categories.map((c) => c.id)).toEqual(["cat-b"]);
    expect(store.selectedCategoryId).toBe("cat-b");
  });

  it("在全部清理失败时仍保留删除动作并返回失败列表", async () => {
    const store = useNexusStore();
    store.config = createConfig();
    store.index = createIndex();
    store.selectedCategoryId = "cat-a";

    mocks.syncService.deleteRemoteFile.mockRejectedValue(new Error("remote failure"));

    const result = await store.deleteCategory("cat-a");

    expect(result.deletedFiles).toBe(0);
    expect(result.failedFiles).toEqual(["file-1.yaml", "file-2.yaml"]);
    expect(store.index?.categories.map((c) => c.id)).toEqual(["cat-b"]);
    expect(mocks.syncService.pushIndex).toHaveBeenCalledTimes(2);
  });
});
