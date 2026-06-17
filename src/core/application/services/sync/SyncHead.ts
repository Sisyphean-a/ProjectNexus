import type { NexusIndex } from "../../../domain/entities/types";
import { calculateChecksum } from "../../../domain/shared/Hash";
import type { ShardStateIndex } from "./SyncTypes";

export interface SyncHead {
  version: 1;
  updated_at: string;
  schemaVersion: number;
  indexHash: string;
  shardStateHash: string;
}

export function buildSyncHead(
  index: NexusIndex,
  shardState: ShardStateIndex | null,
  schemaVersion = 3,
): SyncHead {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    schemaVersion,
    indexHash: calculateChecksum(JSON.stringify(index)),
    shardStateHash: calculateChecksum(JSON.stringify(shardState || { shards: [] })),
  };
}

export function parseSyncHead(raw: string | undefined): SyncHead | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SyncHead;
    if (!parsed || !parsed.indexHash || !parsed.shardStateHash) {
      return null;
    }
    return {
      version: 1,
      updated_at: parsed.updated_at || new Date().toISOString(),
      schemaVersion: parsed.schemaVersion || 3,
      indexHash: parsed.indexHash,
      shardStateHash: parsed.shardStateHash,
    };
  } catch {
    return null;
  }
}

export function serializeSyncHead(head: SyncHead): string {
  return JSON.stringify(head, null, 2);
}

export function calculateSyncHeadHash(raw: string): string {
  return calculateChecksum(raw);
}
