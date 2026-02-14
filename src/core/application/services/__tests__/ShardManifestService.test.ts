import { describe, expect, it, vi } from "vitest";
import { NexusFile } from "../../../domain/entities/NexusFile";
import type {
  GistIndexItem,
  NexusIndex,
  ShardManifest,
} from "../../../domain/entities/types";
import { ShardManifestService } from "../ShardManifestService";

function createBaseIndex(): NexusIndex {
  return {
    version: 2,
    updated_at: "2026-01-01T00:00:00.000Z",
    categories: [],
    shards: [
      {
        id: "shard-1",
        gistId: "gist-1",
        categoryId: "cat-1",
        categoryName: "Cat 1",
        part: 1,
        kind: "category",
        fileCount: 0,
        totalBytes: 0,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function createIndexItem(): GistIndexItem {
  return {
    id: "file-1",
    title: "File 1",
    gist_file: "file-1.yaml",
    language: "yaml",
    storage: {
      shardId: "shard-1",
      gistId: "gist-1",
      gist_file: "file-1.yaml",
    },
  };
}

describe("ShardManifestService", () => {
  it("upsert 新文件会更新 manifest 与 shard 统计", async () => {
    const fetchShardManifest = vi.fn().mockResolvedValue({
      version: 1,
      shardId: "shard-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      files: [],
    } as ShardManifest);
    const updateShardManifest = vi.fn().mockResolvedValue("2026-01-02T00:00:00.000Z");
    const service = new ShardManifestService({
      fetchShardManifest,
      updateShardManifest,
    });

    const index = createBaseIndex();
    const item = createIndexItem();
    const file = new NexusFile("file-1", "File 1", "hello", "yaml");

    await service.upsert(index, item, file, "2026-01-02T00:00:00.000Z");

    expect(index.shards?.[0].fileCount).toBe(1);
    expect(index.shards?.[0].totalBytes).toBe(5);
    expect(updateShardManifest).toHaveBeenCalledTimes(1);
    const manifestArg = updateShardManifest.mock.calls[0][1] as ShardManifest;
    expect(manifestArg.files).toHaveLength(1);
    expect(manifestArg.files[0].fileId).toBe("file-1");
    expect(manifestArg.files[0].size).toBe(5);
  });

  it("upsert 已存在文件会更新尺寸而不增加计数", async () => {
    const fetchShardManifest = vi.fn().mockResolvedValue({
      version: 1,
      shardId: "shard-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      files: [
        {
          fileId: "file-1",
          filename: "file-1.yaml",
          checksum: "old",
          updated_at: "2026-01-01T00:00:00.000Z",
          size: 2,
        },
      ],
    } as ShardManifest);
    const updateShardManifest = vi.fn().mockResolvedValue("2026-01-02T00:00:00.000Z");
    const service = new ShardManifestService({
      fetchShardManifest,
      updateShardManifest,
    });

    const index = createBaseIndex();
    if (index.shards) {
      index.shards[0].fileCount = 1;
      index.shards[0].totalBytes = 2;
    }
    const item = createIndexItem();
    const file = new NexusFile("file-1", "File 1", "hello world", "yaml");

    await service.upsert(index, item, file, "2026-01-02T00:00:00.000Z");

    expect(index.shards?.[0].fileCount).toBe(1);
    expect(index.shards?.[0].totalBytes).toBe(11);
  });

  it("removeByItem 会从 manifest 删除并更新统计", async () => {
    const fetchShardManifest = vi.fn().mockResolvedValue({
      version: 1,
      shardId: "shard-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      files: [
        {
          fileId: "file-1",
          filename: "file-1.yaml",
          checksum: "old",
          updated_at: "2026-01-01T00:00:00.000Z",
          size: 11,
        },
      ],
    } as ShardManifest);
    const updateShardManifest = vi.fn().mockResolvedValue("2026-01-02T00:00:00.000Z");
    const service = new ShardManifestService({
      fetchShardManifest,
      updateShardManifest,
    });

    const index = createBaseIndex();
    if (index.shards) {
      index.shards[0].fileCount = 1;
      index.shards[0].totalBytes = 11;
    }
    const item = createIndexItem();

    await service.removeByItem(index, item);

    expect(index.shards?.[0].fileCount).toBe(0);
    expect(index.shards?.[0].totalBytes).toBe(0);
    const manifestArg = updateShardManifest.mock.calls[0][1] as ShardManifest;
    expect(manifestArg.files).toHaveLength(0);
  });

  it("removeByStorage 在 descriptor 不存在时安全返回", async () => {
    const fetchShardManifest = vi.fn();
    const updateShardManifest = vi.fn();
    const service = new ShardManifestService({
      fetchShardManifest,
      updateShardManifest,
    });

    const index = createBaseIndex();
    await service.removeByStorage(index, "file-1", {
      shardId: "missing-shard",
      gistId: "gist-1",
      gist_file: "file-1.yaml",
    });

    expect(fetchShardManifest).not.toHaveBeenCalled();
    expect(updateShardManifest).not.toHaveBeenCalled();
  });
});
