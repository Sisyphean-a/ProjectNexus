import { describe, expect, it } from "vitest";
import type { ShardManifest } from "../../../../domain/entities/types";
import { ShardStateService } from "../ShardStateService";

const service = new ShardStateService();

describe("ShardStateService", () => {
  it("calculateManifestHash 对文件顺序稳定", () => {
    const first: ShardManifest = {
      version: 1,
      shardId: "shard-1",
      updated_at: "2026-01-01T00:00:00.000Z",
      files: [
        {
          fileId: "b",
          filename: "b.yaml",
          checksum: "checksum-b",
          updated_at: "2026-01-01T00:00:00.000Z",
          size: 2,
        },
        {
          fileId: "a",
          filename: "a.yaml",
          checksum: "checksum-a",
          updated_at: "2026-01-01T00:00:00.000Z",
          size: 1,
        },
      ],
    };

    const second: ShardManifest = {
      ...first,
      files: [...first.files].reverse(),
    };

    expect(service.calculateManifestHash(first)).toBe(
      service.calculateManifestHash(second),
    );
  });

  it("getChangedShardGists 会返回 manifest hash 变化的分片", () => {
    const changed = service.getChangedShardGists(
      { "gist-1": "old", "gist-2": "same" },
      {
        version: 1,
        updated_at: "2026-01-01T00:00:00.000Z",
        shards: [
          {
            shardId: "shard-1",
            gistId: "gist-1",
            manifestHash: "new",
            updated_at: "2026-01-01T00:00:00.000Z",
            fileCount: 1,
            totalBytes: 10,
          },
          {
            shardId: "shard-2",
            gistId: "gist-2",
            manifestHash: "same",
            updated_at: "2026-01-01T00:00:00.000Z",
            fileCount: 1,
            totalBytes: 10,
          },
        ],
      },
      "2026-01-01T00:00:00.000Z",
    );

    expect(Array.from(changed ?? [])).toEqual(["gist-1"]);
  });
});
