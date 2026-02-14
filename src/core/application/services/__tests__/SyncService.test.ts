import { beforeEach, describe, expect, it, vi } from "vitest";
import { NexusFile } from "../../../domain/entities/NexusFile";
import type { NexusIndex } from "../../../domain/entities/types";
import { SyncService } from "../SyncService";
import { createConfig } from "../../../../../tests/factories/createConfig";
import {
  createCategory,
  createIndex,
  createIndexItem,
  createShard,
} from "../../../../../tests/factories/createIndex";

function createDeps() {
  const gistRepo = {
    verifyToken: vi.fn(),
    fetchGist: vi.fn(),
    findNexusGist: vi.fn(),
    createNexusGist: vi.fn(),
    createShardGist: vi.fn(),
    updateGistFile: vi.fn(),
    getGistContent: vi.fn(),
    getGistFilesByNames: vi.fn(),
    getGistHistory: vi.fn(),
    updateBatch: vi.fn(),
    updateGistDescription: vi.fn(),
    deleteGist: vi.fn(),
    getGistVersion: vi.fn(),
    listNexusShards: vi.fn(),
    listAllShardGistIds: vi.fn(),
    fetchShardManifest: vi.fn(),
    updateShardManifest: vi.fn(),
  };

  const localStore = {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
    getIndex: vi.fn(),
    saveIndex: vi.fn(),
    getCache: vi.fn(),
    saveCache: vi.fn(),
  };

  const fileRepo = {
    save: vi.fn(),
    saveBulk: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };

  const cryptoProvider = {
    encrypt: vi.fn(async (text: string) => `enc:${text}`),
    decrypt: vi.fn(async (text: string) => `dec:${text}`),
    setPassword: vi.fn(),
    hasPassword: vi.fn(() => true),
    clearPassword: vi.fn(),
  };

  const service = new SyncService(
    gistRepo as any,
    localStore as any,
    fileRepo as any,
    cryptoProvider as any,
  );

  return { gistRepo, localStore, fileRepo, cryptoProvider, service };
}

describe("SyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializeNexus 会升级为 v2 并保存本地索引", async () => {
    const { gistRepo, localStore, service } = createDeps();
    gistRepo.createNexusGist.mockResolvedValue("root-1");
    const index: NexusIndex = {
      version: 1,
      updated_at: "2026-01-01T00:00:00.000Z",
      categories: [createCategory({ id: "cat-a", items: [] })],
    };

    const gistId = await service.initializeNexus(index);

    expect(gistId).toBe("root-1");
    expect(index.version).toBe(2);
    expect(index.shards).toEqual([]);
    expect(localStore.saveIndex).toHaveBeenCalledWith(index);
  });

  it("syncDown 在未找到 root gist 时抛错", async () => {
    const { gistRepo, service } = createDeps();
    gistRepo.findNexusGist.mockResolvedValue(null);

    await expect(
      service.syncDown(createConfig({ gistId: null, rootGistId: null }), null),
    ).rejects.toThrow("未找到 Nexus Gist");
  });

  it("syncDown 在远程未变化时跳过拉取并返回配置更新", async () => {
    const { gistRepo, service } = createDeps();
    gistRepo.fetchGist.mockResolvedValue({
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const result = await service.syncDown(
      createConfig({ gistId: "root-1", rootGistId: null, schemaVersion: 2 }),
      "2026-01-01T00:00:00.000Z",
    );

    expect(result.synced).toBe(false);
    expect(result.index).toBeNull();
    expect(result.configUpdates).toEqual({ rootGistId: "root-1" });
  });

  it("syncDown 会加载 v2 index 并执行 shard 拉取流程", async () => {
    const { gistRepo, localStore, service } = createDeps();
    const pullSpy = vi
      .spyOn(service as any, "pullShardChanges")
      .mockResolvedValue(undefined);

    const remoteIndex = createIndex({
      categories: [createCategory({ id: "cat-a", name: "Category A", items: [] })],
      shards: [
        createShard({
          id: "shard-1",
          categoryId: "cat-a",
          categoryName: undefined,
          gistId: "shard-gist-1",
        }),
      ],
    });

    gistRepo.fetchGist.mockResolvedValue({
      updated_at: "2026-02-01T00:00:00.000Z",
    });
    gistRepo.getGistFilesByNames.mockResolvedValue({
      "nexus_index_v2.json": {
        content: JSON.stringify(remoteIndex),
      },
      "nexus_shards.json": {
        content: "{invalid-json}",
      },
    });

    const result = await service.syncDown(
      createConfig({ rootGistId: "root-1", gistId: "root-1" }),
      "2026-01-01T00:00:00.000Z",
    );

    expect(result.synced).toBe(true);
    expect(result.gistUpdatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(result.index?.shards?.[0].categoryName).toBe("Category A");
    expect(pullSpy).toHaveBeenCalledTimes(1);
    expect(localStore.saveIndex).toHaveBeenCalledTimes(1);
  });

  it("pushIndex 在发现远端更新时抛出冲突", async () => {
    const { gistRepo, service } = createDeps();
    gistRepo.fetchGist.mockResolvedValue({
      updated_at: "2026-03-01T00:00:00.000Z",
    });

    await expect(
      service.pushIndex(
        "root-1",
        createIndex(),
        "2026-01-01T00:00:00.000Z",
        false,
      ),
    ).rejects.toThrow("同步冲突");

    expect(gistRepo.updateBatch).not.toHaveBeenCalled();
  });

  it("pushIndex 在 force=true 时跳过冲突检查", async () => {
    const { gistRepo, localStore, service } = createDeps();
    gistRepo.updateBatch.mockResolvedValue("2026-03-02T00:00:00.000Z");

    const newTime = await service.pushIndex(
      "root-1",
      createIndex(),
      "2026-01-01T00:00:00.000Z",
      true,
    );

    expect(newTime).toBe("2026-03-02T00:00:00.000Z");
    expect(gistRepo.fetchGist).not.toHaveBeenCalled();
    expect(gistRepo.updateBatch).toHaveBeenCalledTimes(1);
    expect(localStore.saveIndex).toHaveBeenCalledTimes(1);
  });

  it("pushFile 在安全文件未设置密码时拒绝推送", async () => {
    const { cryptoProvider, service } = createDeps();
    cryptoProvider.hasPassword.mockReturnValue(false);
    const index = createIndex();
    const file = new NexusFile(
      "file-1",
      "File 1",
      "secret",
      "yaml",
      [],
      "2026-01-01T00:00:00.000Z",
      true,
    );
    file.isSecure = true;

    await expect(service.pushFile("root-1", index, "file-1", file)).rejects.toThrow(
      "Vault password not set",
    );
  });

  it("pushFile 会加密内容并更新 manifest 与本地状态", async () => {
    const { gistRepo, fileRepo, cryptoProvider, service } = createDeps();
    const upsertSpy = vi
      .spyOn((service as any).shardManifestService, "upsert")
      .mockResolvedValue(undefined);

    gistRepo.updateGistFile.mockResolvedValue("2026-04-01T00:00:00.000Z");
    cryptoProvider.hasPassword.mockReturnValue(true);
    cryptoProvider.encrypt.mockResolvedValue("cipher-text");

    const index = createIndex();
    const file = new NexusFile(
      "file-1",
      "File 1",
      "secret",
      "yaml",
      [],
      "2026-01-01T00:00:00.000Z",
      true,
    );
    file.isSecure = true;

    const result = await service.pushFile("root-1", index, "file-1", file);

    expect(result).toBe("2026-04-01T00:00:00.000Z");
    expect(gistRepo.updateGistFile).toHaveBeenCalledWith(
      "shard-gist-1",
      "file-1.yaml",
      "cipher-text",
    );
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(file.isDirty).toBe(false);
    expect(fileRepo.save).toHaveBeenCalledWith(file);
  });

  it("deleteRemoteFile 在提供 storageOverride 时走指定 shard", async () => {
    const { gistRepo, service } = createDeps();
    const removeSpy = vi
      .spyOn((service as any).shardManifestService, "removeByStorage")
      .mockResolvedValue(undefined);

    gistRepo.updateGistFile.mockResolvedValue("2026-05-01T00:00:00.000Z");
    const index = createIndex();
    const storage = {
      shardId: "shard-x",
      gistId: "gist-x",
      gist_file: "file-x.yaml",
    };

    const result = await service.deleteRemoteFile(
      "root-1",
      index,
      "file-1",
      "file-1.yaml",
      storage,
    );

    expect(result).toBe("2026-05-01T00:00:00.000Z");
    expect(gistRepo.updateGistFile).toHaveBeenCalledWith(
      "gist-x",
      "file-1.yaml",
      null,
    );
    expect(removeSpy).toHaveBeenCalledWith(index, "file-1", storage);
  });

  it("deleteRemoteFile 在索引缺 storage 时回退到 root gist", async () => {
    const { gistRepo, service } = createDeps();
    gistRepo.updateGistFile.mockResolvedValue("2026-05-02T00:00:00.000Z");
    const item = createIndexItem({ id: "file-1", storage: undefined });
    const index = createIndex({
      categories: [createCategory({ id: "cat-a", items: [item] })],
    });

    const result = await service.deleteRemoteFile(
      "root-1",
      index,
      "file-1",
      "file-1.yaml",
    );

    expect(result).toBe("2026-05-02T00:00:00.000Z");
    expect(gistRepo.updateGistFile).toHaveBeenCalledWith(
      "root-1",
      "file-1.yaml",
      null,
    );
  });

  it("assignStorageForItem 会优先复用同分类 shard", async () => {
    const { gistRepo, service } = createDeps();
    const shard = createShard({
      id: "cat-cat_a-part-1",
      gistId: "existing-shard-gist",
      categoryId: "cat-a",
      fileCount: 1,
      totalBytes: 100,
    });
    const index = createIndex({
      categories: [createCategory({ id: "cat-a", items: [] })],
      shards: [shard],
    });
    const item = createIndexItem({ gist_file: "new-file.yaml" });

    const storage = await service.assignStorageForItem(
      "root-1",
      index,
      "cat-a",
      item,
      "small-content",
    );

    expect(storage).toEqual({
      shardId: "cat-cat_a-part-1",
      gistId: "existing-shard-gist",
      gist_file: "new-file.yaml",
    });
    expect(gistRepo.createShardGist).not.toHaveBeenCalled();
  });

  it("assignStorageForItem 在无可用分片时创建 large shard", async () => {
    const { gistRepo, service } = createDeps();
    gistRepo.createShardGist.mockResolvedValue("large-gist-1");
    const index = createIndex({
      categories: [createCategory({ id: "cat-a", items: [] })],
      shards: [],
    });
    const item = createIndexItem({ gist_file: "big-file.yaml" });

    const storage = await service.assignStorageForItem(
      "root-1",
      index,
      "cat-a",
      item,
      "x".repeat(600 * 1024),
    );

    expect(storage.shardId).toBe("large-part-1");
    expect(storage.gistId).toBe("large-gist-1");
    expect(index.shards?.[0].kind).toBe("large");
  });

  it("repairShards dry-run 会统计重复分片并识别空分片", async () => {
    const { gistRepo, service } = createDeps();
    gistRepo.fetchShardManifest.mockResolvedValue({
      version: 1,
      shardId: "shard-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      files: [],
    });

    const index = createIndex({
      categories: [],
      shards: [
        createShard({
          id: "shard-1",
          gistId: "gist-dup",
          kind: "large",
          categoryId: undefined,
          categoryName: "Large Files",
        }),
        createShard({
          id: "shard-1-copy",
          gistId: "gist-dup",
          kind: "large",
          categoryId: undefined,
          categoryName: "Large Files",
        }),
      ],
    });

    const result = await service.repairShards("root-1", index, {
      apply: false,
    });

    expect(result.applied).toBe(false);
    expect(result.rawShardCount).toBe(2);
    expect(result.dedupedShardCount).toBe(1);
    expect(result.duplicateRowsMerged).toBe(1);
    expect(result.removedEmptyShards).toBe(1);
    expect(result.removedShardGists).toEqual(["gist-dup"]);
    expect(gistRepo.updateBatch).not.toHaveBeenCalled();
  });

  it("parseShards 遇到非法 JSON 时回退到 fallback", () => {
    const { service } = createDeps();
    const fallback = [createShard({ id: "fallback" })];

    const parsed = (service as any).parseShards("not-json", fallback);

    expect(parsed).toBe(fallback);
  });
});
