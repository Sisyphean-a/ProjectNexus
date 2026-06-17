import type { IGistRepository } from "../../ports/IGistRepository";
import type { ILocalStore } from "../../ports/ILocalStore";
import type {
  NexusIndex,
  ShardDescriptor,
  ShardManifestItem,
} from "../../../domain/entities/types";
import {
  NEXUS_INDEX_V2_FILENAME,
  NEXUS_SHARDS_FILENAME,
} from "./SyncConstants";
import type {
  IndexedItem,
  RepairShardsOptions,
  RepairShardsResult,
} from "./SyncTypes";

interface RepairDependencies {
  gistRepo: Pick<
    IGistRepository,
    | "fetchShardManifest"
    | "updateGistFile"
    | "updateGistDescription"
    | "updateBatch"
    | "deleteGist"
    | "listAllShardGistIds"
  >;
  localStore: Pick<ILocalStore, "saveIndex">;
}

export class ShardRepairService {
  constructor(private readonly deps: RepairDependencies) {}

  async repair(
    rootGistId: string,
    index: NexusIndex,
    options: RepairShardsOptions = {},
  ): Promise<RepairShardsResult> {
    const apply = options.apply ?? false;
    const rewriteReadme = options.rewriteReadme ?? true;
    const rewriteDescription = options.rewriteDescription ?? true;
    const dropEmptyShards = options.dropEmptyShards ?? true;
    const deleteOrphanGists = options.deleteOrphanGists ?? false;
    const sweepUnreferencedShardGists =
      options.sweepUnreferencedShardGists ?? false;
    const legacyGistIdToDelete = options.legacyGistIdToDelete || null;

    const normalized = this.ensureV2Index(index);
    this.hydrateShardCategoryNames(normalized);

    const rawShards = [...(normalized.shards || [])];
    const dedupedByGist = this.dedupeShards(rawShards);
    const fileById = this.buildItemMapById(normalized);
    const categoryNameById = this.buildCategoryNameMap(normalized);
    const repairedShards: ShardDescriptor[] = [];
    const removableShardGists: string[] = [];
    let manifestsLoaded = 0;

    for (const shard of dedupedByGist.shards.values()) {
      const manifest = await this.deps.gistRepo.fetchShardManifest(shard.gistId);
      if (manifest) {
        manifestsLoaded += 1;
      }

      const linkedFileIds = this.collectLinkedFileIds(fileById, shard);
      const manifestFiles = manifest?.files || [];
      const manifestByFileId = new Map<string, ShardManifestItem>();
      for (const row of manifestFiles) {
        manifestByFileId.set(row.fileId, row);
      }

      const categoryId = this.resolveCategoryId(shard, linkedFileIds, fileById);
      const categoryName = this.resolveCategoryName(
        shard,
        categoryId,
        categoryNameById,
      );
      const filesForStats = this.resolveFilesForStats(
        linkedFileIds,
        manifestByFileId,
        manifestFiles,
      );
      const linkedCount = linkedFileIds.size;
      const manifestCount = manifestFiles.length;
      const totalBytes = filesForStats.reduce(
        (sum, file) => sum + (file.size || 0),
        0,
      );
      const orphanManifestEntries = manifestFiles.filter(
        (file) => !fileById.has(file.fileId),
      ).length;

      const repaired: ShardDescriptor = {
        ...shard,
        categoryId: shard.kind === "large" ? undefined : categoryId,
        categoryName,
        part: shard.part || this.inferPart(shard.id),
        fileCount: linkedCount > 0 ? linkedCount : manifestCount,
        totalBytes,
        updated_at: manifest?.updated_at || shard.updated_at,
      };

      if (dropEmptyShards && linkedCount === 0 && manifestCount === 0) {
        removableShardGists.push(shard.gistId);
        continue;
      }

      repairedShards.push(repaired);
      await this.rewriteShardMetadata(
        repaired,
        apply,
        rewriteReadme,
        rewriteDescription,
        linkedCount,
        manifestCount,
        totalBytes,
        orphanManifestEntries,
      );
    }

    repairedShards.sort((left, right) => {
      const leftKey = `${left.kind}:${left.categoryName || ""}:${left.part}`;
      const rightKey = `${right.kind}:${right.categoryName || ""}:${right.part}`;
      return leftKey.localeCompare(rightKey);
    });

    return this.persistRepairResult(
      rootGistId,
      normalized,
      repairedShards,
      dedupedByGist.duplicateRowsMerged,
      rawShards.length,
      manifestsLoaded,
      removableShardGists,
      sweepUnreferencedShardGists,
      deleteOrphanGists,
      legacyGistIdToDelete,
      apply,
    );
  }

  private ensureV2Index(index: NexusIndex): NexusIndex {
    if ((index.version || 1) >= 2) {
      if (!index.shards) {
        index.shards = [];
      }
      return index;
    }

    index.version = 2;
    index.shards = index.shards || [];
    return index;
  }

  private hydrateShardCategoryNames(index: NexusIndex): void {
    const names = this.buildCategoryNameMap(index);
    for (const shard of index.shards || []) {
      if (shard.kind === "large") {
        shard.categoryName = "Large Files";
        continue;
      }
      if (!shard.categoryName && shard.categoryId) {
        shard.categoryName = names.get(shard.categoryId) || shard.categoryId;
      }
    }
  }

  private buildCategoryNameMap(index: NexusIndex): Map<string, string> {
    const categoryNameById = new Map<string, string>();
    for (const category of index.categories) {
      categoryNameById.set(category.id, category.name);
    }
    return categoryNameById;
  }

  private dedupeShards(rawShards: ShardDescriptor[]) {
    const shards = new Map<string, ShardDescriptor>();
    let duplicateRowsMerged = 0;

    for (const shard of rawShards) {
      const normalizedShard: ShardDescriptor = {
        id: shard.id || `shard-${shard.gistId}`,
        gistId: shard.gistId,
        categoryId: shard.categoryId,
        categoryName: shard.categoryName,
        part: shard.part || this.inferPart(shard.id),
        kind: shard.kind || (shard.categoryId ? "category" : "large"),
        fileCount: shard.fileCount || 0,
        totalBytes: shard.totalBytes || 0,
        updated_at: shard.updated_at || new Date().toISOString(),
      };

      const existing = shards.get(normalizedShard.gistId);
      if (!existing) {
        shards.set(normalizedShard.gistId, normalizedShard);
        continue;
      }

      duplicateRowsMerged += 1;
      shards.set(
        normalizedShard.gistId,
        this.mergeShardDescriptor(existing, normalizedShard),
      );
    }

    return { shards, duplicateRowsMerged };
  }

  private buildItemMapById(index: NexusIndex): Map<string, IndexedItem> {
    const map = new Map<string, IndexedItem>();
    for (const category of index.categories) {
      for (const item of category.items) {
        map.set(item.id, { categoryId: category.id, item });
      }
    }
    return map;
  }

  private collectLinkedFileIds(
    fileById: Map<string, IndexedItem>,
    shard: ShardDescriptor,
  ): Set<string> {
    const linkedFileIds = new Set<string>();
    for (const [fileId, ref] of fileById.entries()) {
      const storage = ref.item.storage;
      if (!storage) {
        continue;
      }
      if (storage.gistId === shard.gistId || storage.shardId === shard.id) {
        linkedFileIds.add(fileId);
      }
    }
    return linkedFileIds;
  }

  private resolveCategoryId(
    shard: ShardDescriptor,
    linkedFileIds: Set<string>,
    fileById: Map<string, IndexedItem>,
  ): string | undefined {
    if (shard.categoryId || shard.kind !== "category") {
      return shard.categoryId;
    }

    const categories = new Set<string>();
    for (const linkedId of linkedFileIds) {
      const ref = fileById.get(linkedId);
      if (ref) {
        categories.add(ref.categoryId);
      }
    }

    if (categories.size === 1) {
      return Array.from(categories)[0];
    }

    return undefined;
  }

  private resolveCategoryName(
    shard: ShardDescriptor,
    categoryId: string | undefined,
    categoryNameById: Map<string, string>,
  ): string {
    if (shard.kind === "large") {
      return "Large Files";
    }

    if (categoryId) {
      return categoryNameById.get(categoryId) || categoryId;
    }

    return shard.categoryName || "Unknown Category";
  }

  private resolveFilesForStats(
    linkedFileIds: Set<string>,
    manifestByFileId: Map<string, ShardManifestItem>,
    manifestFiles: ShardManifestItem[],
  ): ShardManifestItem[] {
    if (linkedFileIds.size === 0) {
      return manifestFiles;
    }

    return Array.from(linkedFileIds)
      .map((fileId) => manifestByFileId.get(fileId))
      .filter((file): file is ShardManifestItem => !!file);
  }

  private async rewriteShardMetadata(
    shard: ShardDescriptor,
    apply: boolean,
    rewriteReadme: boolean,
    rewriteDescription: boolean,
    linkedCount: number,
    manifestCount: number,
    totalBytes: number,
    orphanManifestEntries: number,
  ): Promise<void> {
    if (!apply) {
      return;
    }

    if (rewriteReadme) {
      await this.deps.gistRepo.updateGistFile(
        shard.gistId,
        "README.md",
        this.buildShardReadme(
          shard,
          linkedCount,
          manifestCount,
          totalBytes,
          orphanManifestEntries,
        ),
      );
    }

    if (rewriteDescription) {
      await this.deps.gistRepo.updateGistDescription(
        shard.gistId,
        this.buildShardDescription(shard),
      );
    }
  }

  private async persistRepairResult(
    rootGistId: string,
    normalized: NexusIndex,
    repairedShards: ShardDescriptor[],
    duplicateRowsMerged: number,
    rawShardCount: number,
    manifestsLoaded: number,
    removableShardGists: string[],
    sweepUnreferencedShardGists: boolean,
    deleteOrphanGists: boolean,
    legacyGistIdToDelete: string | null,
    apply: boolean,
  ): Promise<RepairShardsResult> {
    let rootUpdatedAt: string | undefined;
    const deletedShardGistIds: string[] = [];
    let deletedLegacyGistId: string | undefined;
    const sweptShardGistIds: string[] = [];

    if (apply) {
      normalized.shards = repairedShards;
      normalized.updated_at = new Date().toISOString();
      rootUpdatedAt = await this.deps.gistRepo.updateBatch(rootGistId, {
        [NEXUS_INDEX_V2_FILENAME]: JSON.stringify(normalized, null, 2),
        [NEXUS_SHARDS_FILENAME]: JSON.stringify(repairedShards, null, 2),
      });
      await this.deps.localStore.saveIndex(normalized);

      if (deleteOrphanGists) {
        for (const gistId of Array.from(new Set(removableShardGists))) {
          await this.deps.gistRepo.deleteGist(gistId);
          deletedShardGistIds.push(gistId);
        }
      }

      if (sweepUnreferencedShardGists) {
        const allShardGists = await this.deps.gistRepo.listAllShardGistIds();
        const keep = new Set<string>([
          rootGistId,
          ...repairedShards.map((shard) => shard.gistId),
        ]);

        for (const gistId of allShardGists) {
          if (keep.has(gistId) || deletedShardGistIds.includes(gistId)) {
            continue;
          }
          await this.deps.gistRepo.deleteGist(gistId);
          sweptShardGistIds.push(gistId);
        }
      }

      deletedLegacyGistId = await this.deleteLegacyGist(
        legacyGistIdToDelete,
        rootGistId,
        deletedShardGistIds,
        sweptShardGistIds,
      );
    }

    return {
      applied: apply,
      rawShardCount,
      dedupedShardCount: repairedShards.length + removableShardGists.length,
      duplicateRowsMerged,
      manifestsLoaded,
      repairedShardCount: repairedShards.length,
      removedEmptyShards: removableShardGists.length,
      removedShardGists: Array.from(new Set(removableShardGists)),
      sweptUnreferencedShardGists: sweptShardGistIds.length,
      sweptShardGistIds,
      deletedLegacyGistId,
      rootUpdatedAt,
    };
  }

  private async deleteLegacyGist(
    legacyGistIdToDelete: string | null,
    rootGistId: string,
    deletedShardGistIds: string[],
    sweptShardGistIds: string[],
  ): Promise<string | undefined> {
    if (
      !legacyGistIdToDelete
      || legacyGistIdToDelete === rootGistId
      || deletedShardGistIds.includes(legacyGistIdToDelete)
      || sweptShardGistIds.includes(legacyGistIdToDelete)
    ) {
      return undefined;
    }

    try {
      await this.deps.gistRepo.deleteGist(legacyGistIdToDelete);
      return legacyGistIdToDelete;
    } catch (error) {
      console.warn(
        `[SyncService] Failed to delete legacy gist ${legacyGistIdToDelete}`,
        error,
      );
      return undefined;
    }
  }

  private inferPart(value: string | undefined): number {
    if (!value) {
      return 1;
    }
    const match = value.match(/part-(\d+)/i);
    if (!match) {
      return 1;
    }
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  private mergeShardDescriptor(
    base: ShardDescriptor,
    incoming: ShardDescriptor,
  ): ShardDescriptor {
    return {
      id: base.id || incoming.id,
      gistId: base.gistId || incoming.gistId,
      categoryId: base.categoryId || incoming.categoryId,
      categoryName: base.categoryName || incoming.categoryName,
      part: base.part || incoming.part || 1,
      kind: base.kind || incoming.kind,
      fileCount: Math.max(base.fileCount || 0, incoming.fileCount || 0),
      totalBytes: Math.max(base.totalBytes || 0, incoming.totalBytes || 0),
      updated_at:
        base.updated_at || incoming.updated_at || new Date().toISOString(),
    };
  }

  private buildShardReadme(
    shard: ShardDescriptor,
    linkedCount: number,
    manifestCount: number,
    totalBytes: number,
    orphanManifestEntries: number,
  ): string {
    const summary = `[${shard.kind}] ${shard.categoryName || "N/A"} · Part ${shard.part} · Files ${linkedCount}/${manifestCount} · Orphans ${orphanManifestEntries} · Size ${this.formatBytes(totalBytes)}`;

    return `# Nexus Shard

${summary}

| Key | Value |
| --- | --- |
| Shard | ${shard.id} |
| Gist | ${shard.gistId} |
| Category | ${shard.categoryName || "N/A"} (${shard.categoryId || "N/A"}) |
| Updated | ${shard.updated_at} |
`;
  }

  private buildShardDescription(shard: ShardDescriptor): string {
    if (shard.kind === "large") {
      return `Nexus Shard [large] Large Files #${shard.part}`;
    }

    return `Nexus Shard [category] ${shard.categoryName || shard.categoryId || "Unknown"} (${shard.categoryId || "N/A"}) #${shard.part}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}
