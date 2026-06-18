import { describe, expect, it, vi } from "vitest";
import { ShardPullService } from "../ShardPullService";
import { NexusFile } from "../../../../domain/entities/NexusFile";
import type {
  NexusIndex,
  ShardManifest,
} from "../../../../domain/entities/types";

function buildIndex(): NexusIndex {
  return {
    version: 2,
    updated_at: "2026-01-01T00:00:00.000Z",
    categories: [
      {
        id: "cat-a",
        name: "Cat A",
        icon: "folder",
        defaultLanguage: "yaml",
        items: [
          {
            id: "file-1",
            title: "File 1",
            gist_file: "file-1.yaml",
            language: "yaml",
            tags: [],
            storage: {
              shardId: "cat-cat-a-part-1",
              gistId: "gist-shard-1",
              gist_file: "file-1.yaml",
            },
          },
        ],
      },
    ],
    shards: [
      {
        id: "cat-cat-a-part-1",
        gistId: "gist-shard-1",
        categoryId: "cat-a",
        categoryName: "Cat A",
        part: 1,
        kind: "category",
        fileCount: 1,
        totalBytes: 10,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function manifestWith(checksum: string, size: number): ShardManifest {
  return {
    version: 1,
    shardId: "cat-cat-a-part-1",
    updated_at: "2026-01-02T00:00:00.000Z",
    files: [
      {
        fileId: "file-1",
        filename: "file-1.yaml",
        checksum,
        updated_at: "2026-01-02T00:00:00.000Z",
        size,
        isSecure: false,
      },
    ],
  };
}

function makeDeps(localFile: NexusFile | null, manifest: ShardManifest) {
  const fileRepo = {
    get: vi.fn().mockResolvedValue(localFile),
    saveBulk: vi.fn().mockResolvedValue(undefined),
  };
  const gistRepo = {
    getGistContent: vi.fn().mockResolvedValue({}),
  };
  const fetchedFiles: Record<string, { id: string; filename: string; content: string; updated_at: string }> = {
    "file-1.yaml": {
      id: "file-1.yaml",
      filename: "file-1.yaml",
      content: "remote-content",
      updated_at: "2026-01-02T00:00:00.000Z",
    },
  };
  const shardFetchPlanner = {
    fetchManifests: vi
      .fn()
      .mockResolvedValue([{ gistId: "gist-shard-1", manifest }]),
    fetchFilesByShard: vi.fn().mockResolvedValue([
      { gistId: "gist-shard-1", files: fetchedFiles },
    ]),
  };
  const cryptoProvider = { decrypt: vi.fn() };

  const service = new ShardPullService({
    gistRepo: gistRepo as any,
    fileRepo: fileRepo as any,
    cryptoProvider: cryptoProvider as any,
    shardFetchPlanner: shardFetchPlanner as any,
  });

  return { service, fileRepo, shardFetchPlanner };
}

describe("ShardPullService size guard (Finding 02)", () => {
  it("skips fetch when checksum AND size both match", async () => {
    const local = new NexusFile(
      "file-1",
      "File 1",
      "0123456789", // 10 bytes
      "yaml",
      [],
      "2026-01-01T00:00:00.000Z",
      false,
      "deadbeef",
    );
    const { service, shardFetchPlanner } = makeDeps(local, manifestWith("deadbeef", 10));

    await service.pull({ remoteIndex: buildIndex(), changedShardGists: null });

    expect(shardFetchPlanner.fetchFilesByShard).toHaveBeenCalledWith([], expect.any(Number));
  });

  it("still fetches when checksum collides but size differs", async () => {
    const local = new NexusFile(
      "file-1",
      "File 1",
      "0123456789", // 10 bytes
      "yaml",
      [],
      "2026-01-01T00:00:00.000Z",
      false,
      "deadbeef", // same (colliding) checksum
    );
    // manifest claims same checksum but a different size => content changed
    const { service, shardFetchPlanner } = makeDeps(local, manifestWith("deadbeef", 9999));

    await service.pull({ remoteIndex: buildIndex(), changedShardGists: null });

    expect(shardFetchPlanner.fetchFilesByShard).toHaveBeenCalledWith(
      [{ gistId: "gist-shard-1", filenames: ["file-1.yaml"] }],
      expect.any(Number),
    );
  });
});
