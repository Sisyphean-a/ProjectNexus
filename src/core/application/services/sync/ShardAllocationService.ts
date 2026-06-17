import type { IGistRepository } from "../../ports/IGistRepository";
import type {
  GistIndexItem,
  NexusFileStorage,
  NexusIndex,
  ShardDescriptor,
} from "../../../domain/entities/types";
import {
  LARGE_FILE_BYTES,
  SHARD_FILE_LIMIT,
  SHARD_HARD_BYTES,
  SHARD_TARGET_BYTES,
} from "./SyncConstants";

interface AllocationDependencies {
  gistRepo: Pick<IGistRepository, "createShardGist">;
}

export class ShardAllocationService {
  constructor(private readonly deps: AllocationDependencies) {}

  async assignStorageForItem(
    index: NexusIndex,
    categoryId: string,
    item: GistIndexItem,
    rawContent: string,
  ): Promise<NexusFileStorage> {
    const normalizedIndex = this.ensureV2Index(index);
    const contentBytes = this.byteLength(rawContent);
    const shard = await this.selectOrCreateShard(
      normalizedIndex,
      categoryId,
      contentBytes,
    );
    const storage: NexusFileStorage = {
      shardId: shard.id,
      gistId: shard.gistId,
      gist_file: item.gist_file,
    };

    item.storage = storage;
    item.gist_file = storage.gist_file;
    return storage;
  }

  private ensureV2Index(index: NexusIndex): NexusIndex {
    if ((index.version || 1) < 2) {
      index.version = 2;
    }
    index.shards = index.shards || [];
    return index;
  }

  private async selectOrCreateShard(
    index: NexusIndex,
    categoryId: string,
    contentBytes: number,
  ): Promise<ShardDescriptor> {
    const kind = contentBytes > LARGE_FILE_BYTES ? "large" : "category";
    const candidates = (index.shards || [])
      .filter((shard) =>
        kind === "large"
          ? shard.kind === "large"
          : shard.kind === "category" && shard.categoryId === categoryId,
      )
      .sort((left, right) => left.part - right.part);
    const selected =
      candidates.find((shard) =>
        this.canReuseShard(shard, contentBytes, SHARD_TARGET_BYTES),
      )
      || candidates.find((shard) =>
        this.canReuseShard(shard, contentBytes, SHARD_HARD_BYTES),
      );

    if (selected) {
      return selected;
    }

    return this.createShard(index, categoryId, candidates, kind);
  }

  private canReuseShard(
    shard: ShardDescriptor,
    contentBytes: number,
    byteLimit: number,
  ): boolean {
    return (
      shard.fileCount + 1 <= SHARD_FILE_LIMIT
      && shard.totalBytes + contentBytes <= byteLimit
    );
  }

  private async createShard(
    index: NexusIndex,
    categoryId: string,
    candidates: ShardDescriptor[],
    kind: "category" | "large",
  ): Promise<ShardDescriptor> {
    const part =
      candidates.length > 0 ? Math.max(...candidates.map((shard) => shard.part)) + 1 : 1;
    const shardId =
      kind === "large"
        ? `large-part-${part}`
        : `cat-${this.normalizeId(categoryId)}-part-${part}`;
    const categoryName =
      kind === "large"
        ? "Large Files"
        : index.categories.find((category) => category.id === categoryId)?.name || categoryId;
    const gistId = await this.deps.gistRepo.createShardGist(
      shardId,
      categoryName,
      part,
      kind === "category" ? categoryId : undefined,
      kind,
    );

    const descriptor: ShardDescriptor = {
      id: shardId,
      gistId,
      categoryId: kind === "category" ? categoryId : undefined,
      categoryName,
      part,
      kind,
      fileCount: 0,
      totalBytes: 0,
      updated_at: new Date().toISOString(),
    };

    index.shards = index.shards || [];
    index.shards.push(descriptor);
    return descriptor;
  }

  private normalizeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36);
  }

  private byteLength(content: string): number {
    return new TextEncoder().encode(content).length;
  }
}
