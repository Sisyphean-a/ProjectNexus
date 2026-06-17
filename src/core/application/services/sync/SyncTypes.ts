import type {
  GistIndexItem,
  NexusConfig,
  ShardManifest,
} from "../../../domain/entities/types";

export interface SyncDownResult {
  index: import("../../../domain/entities/types").NexusIndex | null;
  synced: boolean;
  gistUpdatedAt?: string;
  configUpdates?: Partial<NexusConfig>;
}

export interface IndexedItem {
  categoryId: string;
  item: GistIndexItem;
}

export interface ShardFetchPlan {
  [gistId: string]: Set<string>;
}

export interface ShardStateItem {
  shardId: string;
  gistId: string;
  manifestHash: string;
  updated_at: string;
  fileCount: number;
  totalBytes: number;
}

export interface ShardStateIndex {
  version: 1;
  updated_at: string;
  shards: ShardStateItem[];
}

export interface RepairShardsOptions {
  apply?: boolean;
  rewriteReadme?: boolean;
  rewriteDescription?: boolean;
  dropEmptyShards?: boolean;
  deleteOrphanGists?: boolean;
  sweepUnreferencedShardGists?: boolean;
  legacyGistIdToDelete?: string | null;
}

export interface RepairShardsResult {
  applied: boolean;
  rawShardCount: number;
  dedupedShardCount: number;
  duplicateRowsMerged: number;
  manifestsLoaded: number;
  repairedShardCount: number;
  removedEmptyShards: number;
  removedShardGists: string[];
  sweptUnreferencedShardGists: number;
  sweptShardGistIds: string[];
  deletedLegacyGistId?: string;
  rootUpdatedAt?: string;
}

export interface ManifestMap {
  get(gistId: string): ShardManifest | null | undefined;
}
