import type { IGistRepository } from "../../ports/IGistRepository";
import type {
  NexusIndex,
  ShardDescriptor,
  ShardManifest,
} from "../../../domain/entities/types";
import { calculateChecksum } from "../../../domain/shared/Hash";
import { NEXUS_SHARD_STATE_FILENAME } from "./SyncConstants";
import type { ShardStateIndex, ShardStateItem } from "./SyncTypes";

export class ShardStateService {
  constructor(
    private readonly gistRepo?: Pick<
      IGistRepository,
      "getGistFilesByNames" | "updateGistFile"
    >,
  ) {}

  parseShardState(raw: string | undefined): ShardStateIndex | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as ShardStateIndex;
      if (!parsed || !Array.isArray(parsed.shards)) {
        return null;
      }

      return {
        version: 1,
        updated_at: parsed.updated_at || new Date().toISOString(),
        shards: parsed.shards
          .filter((row) => !!row.gistId && !!row.shardId && !!row.manifestHash)
          .map((row) => ({
            shardId: row.shardId,
            gistId: row.gistId,
            manifestHash: row.manifestHash,
            updated_at: row.updated_at || new Date().toISOString(),
            fileCount: row.fileCount || 0,
            totalBytes: row.totalBytes || 0,
          })),
      };
    } catch (error) {
      console.warn("Failed to parse shard state from root", error);
      return null;
    }
  }

  buildShardDigest(state: ShardStateIndex | null): Record<string, string> {
    if (!state) {
      return {};
    }

    const digest: Record<string, string> = {};
    for (const row of state.shards) {
      digest[row.gistId] = row.manifestHash;
    }
    return digest;
  }

  getChangedShardGists(
    localDigest: Record<string, string>,
    remoteState: ShardStateIndex | null,
    lastRemoteUpdatedAt: string | null,
  ): Set<string> | null {
    if (!remoteState || !lastRemoteUpdatedAt) {
      return null;
    }

    const changed = new Set<string>();
    for (const row of remoteState.shards) {
      if (localDigest[row.gistId] !== row.manifestHash) {
        changed.add(row.gistId);
      }
    }
    return changed;
  }

  async updateRootShardState(
    rootGistId: string,
    index: NexusIndex,
    targetGistId: string,
    manifest: ShardManifest | null,
  ): Promise<string | null> {
    const gistRepo = this.requireRepo();
    const currentState = await this.loadRemoteShardState(rootGistId);
    const byGist = new Map<string, ShardStateItem>();

    for (const row of currentState.shards) {
      byGist.set(row.gistId, row);
    }

    if (manifest) {
      const descriptor = (index.shards || []).find((shard) => shard.gistId === targetGistId);
      if (descriptor) {
        byGist.set(targetGistId, this.buildStateItem(descriptor, manifest));
      }
    } else {
      byGist.delete(targetGistId);
    }

    for (const shard of index.shards || []) {
      if (byGist.has(shard.gistId)) {
        continue;
      }

      byGist.set(shard.gistId, {
        shardId: shard.id,
        gistId: shard.gistId,
        manifestHash: "",
        updated_at: shard.updated_at,
        fileCount: shard.fileCount,
        totalBytes: shard.totalBytes,
      });
    }

    const nextState: ShardStateIndex = {
      version: 1,
      updated_at: new Date().toISOString(),
      shards: Array.from(byGist.values()),
    };

    return gistRepo.updateGistFile(
      rootGistId,
      NEXUS_SHARD_STATE_FILENAME,
      JSON.stringify(nextState, null, 2),
    );
  }

  async loadRemoteShardState(rootGistId: string): Promise<ShardStateIndex> {
    const gistRepo = this.requireRepo();
    const files = (await gistRepo.getGistFilesByNames(rootGistId, [
      NEXUS_SHARD_STATE_FILENAME,
    ])) || {};
    const parsed = this.parseShardState(files[NEXUS_SHARD_STATE_FILENAME]?.content);

    return parsed || {
      version: 1,
      updated_at: new Date().toISOString(),
      shards: [],
    };
  }

  buildStateItem(
    descriptor: ShardDescriptor,
    manifest: ShardManifest,
  ): ShardStateItem {
    return {
      shardId: descriptor.id,
      gistId: descriptor.gistId,
      manifestHash: this.calculateManifestHash(manifest),
      updated_at: manifest.updated_at || descriptor.updated_at,
      fileCount: manifest.files.length,
      totalBytes: manifest.files.reduce((sum, file) => sum + (file.size || 0), 0),
    };
  }

  buildShardStateForRoot(
    index: NexusIndex,
    manifestByShard: Map<string, ShardManifest>,
  ): ShardStateIndex {
    const shards: ShardStateItem[] = [];

    for (const descriptor of index.shards || []) {
      const manifest = manifestByShard.get(descriptor.gistId);
      if (!manifest) {
        continue;
      }
      shards.push(this.buildStateItem(descriptor, manifest));
    }

    return {
      version: 1,
      updated_at: new Date().toISOString(),
      shards,
    };
  }

  calculateManifestHash(manifest: ShardManifest): string {
    const stableFiles = [...manifest.files]
      .map((file) => ({
        fileId: file.fileId,
        filename: file.filename,
        checksum: file.checksum,
        updated_at: file.updated_at,
        size: file.size,
        isSecure: !!file.isSecure,
      }))
      .sort((left, right) => left.fileId.localeCompare(right.fileId));

    return calculateChecksum(JSON.stringify(stableFiles));
  }

  private requireRepo(): Pick<IGistRepository, "getGistFilesByNames" | "updateGistFile"> {
    if (!this.gistRepo) {
      throw new Error("ShardStateService requires gist repository for remote operations.");
    }
    return this.gistRepo;
  }
}
