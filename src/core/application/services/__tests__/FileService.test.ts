import { beforeEach, describe, expect, it, vi } from "vitest";
import { NexusFile } from "../../../domain/entities/NexusFile";
import { IdGenerator } from "../../../domain/shared/IdGenerator";
import { FileService } from "../FileService";
import { createConfig } from "../../../../../tests/factories/createConfig";
import {
  createCategory,
  createIndex,
  createIndexItem,
} from "../../../../../tests/factories/createIndex";

const fileRepo = {
  save: vi.fn(),
  saveBulk: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

const syncService = {
  assignStorageForItem: vi.fn(),
  pushIndex: vi.fn(),
  pushFile: vi.fn(),
  deleteRemoteFile: vi.fn(),
};

function createContext() {
  return {
    index: createIndex({
      categories: [createCategory({ id: "cat-a", items: [] })],
      shards: [],
    }),
    config: createConfig(),
    lastRemoteUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("FileService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createFile 在分类不存在时抛错", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const ctx = createContext();

    await expect(
      service.createFile(ctx, "missing-category", "Demo", "yaml"),
    ).rejects.toThrow("Category not found");
  });

  it("createFile 会创建实体并推送索引与文件", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const ctx = createContext();
    vi.spyOn(IdGenerator, "generate").mockReturnValue("new-file");

    syncService.assignStorageForItem.mockImplementation(
      async (_root: string, _index: unknown, _cat: string, item: any) => {
        item.storage = {
          shardId: "shard-1",
          gistId: "shard-gist-1",
          gist_file: "new-file.yaml",
        };
      },
    );
    syncService.pushIndex.mockResolvedValue("2026-01-02T00:00:00.000Z");
    syncService.pushFile.mockResolvedValue("2026-01-03T00:00:00.000Z");

    const result = await service.createFile(
      ctx,
      "cat-a",
      "Demo",
      "yaml",
      "hello",
    );

    expect(result.file.id).toBe("new-file");
    expect(result.newRemoteTime).toBe("2026-01-03T00:00:00.000Z");
    expect(ctx.index.categories[0].items).toHaveLength(1);
    expect(syncService.assignStorageForItem).toHaveBeenCalledTimes(1);
    expect(syncService.pushIndex).toHaveBeenCalledTimes(1);
    expect(syncService.pushFile).toHaveBeenCalledTimes(1);
  });

  it("createFile 在无 root gist 时仅保存本地", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const ctx = createContext();
    ctx.config = createConfig({ gistId: null, rootGistId: null });
    vi.spyOn(IdGenerator, "generate").mockReturnValue("local-only");

    const result = await service.createFile(
      ctx,
      "cat-a",
      "Demo",
      "yaml",
      "hello",
    );

    expect(result.newRemoteTime).toBeUndefined();
    expect(syncService.assignStorageForItem).not.toHaveBeenCalled();
    expect(syncService.pushIndex).not.toHaveBeenCalled();
    expect(syncService.pushFile).not.toHaveBeenCalled();
  });

  it("updateContent 在文件不存在时抛错", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const ctx = createContext();
    fileRepo.get.mockResolvedValue(null);

    await expect(
      service.updateContent(ctx, "missing-file", "new-content"),
    ).rejects.toThrow("File not found");
  });

  it("updateContent 会保存并触发远端推送", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const ctx = createContext();
    const file = new NexusFile("file-1", "File 1", "old", "yaml");
    fileRepo.get.mockResolvedValue(file);
    syncService.pushFile.mockResolvedValue("2026-01-04T00:00:00.000Z");

    const result = await service.updateContent(ctx, "file-1", "new");

    expect(fileRepo.save).toHaveBeenCalledWith(file);
    expect(syncService.pushFile).toHaveBeenCalledTimes(1);
    expect(result.newRemoteTime).toBe("2026-01-04T00:00:00.000Z");
  });

  it("deleteFile 会删除索引项并串联远端删除与索引推送", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const item = createIndexItem({ id: "file-1", gist_file: "file-1.yaml" });
    const ctx = {
      ...createContext(),
      index: createIndex({
        categories: [createCategory({ id: "cat-a", items: [item] })],
      }),
    };

    syncService.deleteRemoteFile.mockResolvedValue("2026-01-05T00:00:00.000Z");
    syncService.pushIndex.mockResolvedValue("2026-01-06T00:00:00.000Z");

    const result = await service.deleteFile(ctx, "cat-a", "file-1");

    expect(fileRepo.delete).toHaveBeenCalledWith("file-1");
    expect(syncService.deleteRemoteFile).toHaveBeenCalledWith(
      "root-gist",
      ctx.index,
      "file-1",
      "file-1.yaml",
      item.storage,
    );
    expect(syncService.pushIndex).toHaveBeenCalledWith(
      "root-gist",
      ctx.index,
      "2026-01-05T00:00:00.000Z",
    );
    expect(ctx.index.categories[0].items).toHaveLength(0);
    expect(result.newRemoteTime).toBe("2026-01-06T00:00:00.000Z");
  });

  it("updateFileMetadata 会同步更新实体与索引", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const item = createIndexItem({ id: "file-1", title: "Old", tags: ["a"] });
    const ctx = {
      ...createContext(),
      index: createIndex({
        categories: [createCategory({ id: "cat-a", items: [item] })],
      }),
    };
    const file = new NexusFile("file-1", "Old", "content", "yaml", ["a"]);
    fileRepo.get.mockResolvedValue(file);
    syncService.pushIndex.mockResolvedValue("2026-01-07T00:00:00.000Z");

    const result = await service.updateFileMetadata(ctx, "file-1", {
      title: "New",
      tags: ["x", "y"],
    });

    expect(file.title).toBe("New");
    expect(file.tags).toEqual(["x", "y"]);
    const updatedItem = ctx.index.categories[0].items[0];
    expect(updatedItem.title).toBe("New");
    expect(updatedItem.tags).toEqual(["x", "y"]);
    expect(fileRepo.save).toHaveBeenCalledWith(file);
    expect(result.newRemoteTime).toBe("2026-01-07T00:00:00.000Z");
  });

  it("updateFileMetadata 在索引缺失时抛错", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const ctx = createContext();
    const file = new NexusFile("file-unknown", "File", "content", "yaml");
    fileRepo.get.mockResolvedValue(file);

    await expect(
      service.updateFileMetadata(ctx, "file-unknown", { title: "Next" }),
    ).rejects.toThrow("File not found in Index");
  });

  it("changeLanguage 在后缀未变化时仅推送索引", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const item = createIndexItem({ id: "file-1", language: "yaml" });
    const ctx = {
      ...createContext(),
      index: createIndex({
        categories: [createCategory({ id: "cat-a", items: [item] })],
      }),
    };
    const file = new NexusFile("file-1", "File 1", "content", "yaml");
    fileRepo.get.mockResolvedValue(file);
    syncService.pushIndex.mockResolvedValue("2026-01-08T00:00:00.000Z");

    const result = await service.changeLanguage(ctx, "file-1", "yaml");

    expect(result.success).toBe(true);
    expect(result.newRemoteTime).toBe("2026-01-08T00:00:00.000Z");
    expect(syncService.deleteRemoteFile).not.toHaveBeenCalled();
    expect(syncService.pushFile).not.toHaveBeenCalled();
    expect(syncService.pushIndex).toHaveBeenCalledTimes(1);
  });

  it("changeLanguage 在后缀变化时执行删除+上传+索引推送", async () => {
    const service = new FileService(fileRepo as any, syncService as any);
    const item = createIndexItem({ id: "file-1", gist_file: "file-1.yaml" });
    const ctx = {
      ...createContext(),
      index: createIndex({
        categories: [createCategory({ id: "cat-a", items: [item] })],
      }),
    };
    const file = new NexusFile("file-1", "File 1", "content", "yaml");
    fileRepo.get.mockResolvedValue(file);
    syncService.deleteRemoteFile.mockResolvedValue("2026-01-09T00:00:00.000Z");
    syncService.pushFile.mockResolvedValue("2026-01-10T00:00:00.000Z");
    syncService.pushIndex.mockResolvedValue("2026-01-11T00:00:00.000Z");

    const result = await service.changeLanguage(ctx, "file-1", "json");

    expect(result.success).toBe(true);
    expect(syncService.deleteRemoteFile).toHaveBeenCalledWith(
      "root-gist",
      ctx.index,
      "file-1",
      "file-1.yaml",
    );
    expect(syncService.pushFile).toHaveBeenCalledTimes(1);
    expect(syncService.pushIndex).toHaveBeenCalledWith(
      "root-gist",
      ctx.index,
      "2026-01-10T00:00:00.000Z",
    );
    expect(result.newRemoteTime).toBe("2026-01-11T00:00:00.000Z");
  });
});
