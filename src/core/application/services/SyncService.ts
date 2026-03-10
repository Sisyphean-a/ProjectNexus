import type { IFileRepository } from "../ports/IFileRepository";
import type { IGistRepository } from "../ports/IGistRepository";
import type { ILocalStore } from "../ports/ILocalStore";
import type { ICryptoProvider } from "../ports/ICryptoProvider";
import type {
  GistIndexItem,
  NexusConfig,
  NexusFileStorage,
  NexusIndex,
  ShardDescriptor,
} from "../../domain/entities/types";
import { NexusFile } from "../../domain/entities/NexusFile";
import { ShardManifestService } from "./ShardManifestService";
import { ConflictGuard } from "./sync/ConflictGuard";
import { LegacyMigrationService } from "./sync/LegacyMigrationService";
import { RemoteFileSyncService } from "./sync/RemoteFileSyncService";
import { ShardAllocationService } from "./sync/ShardAllocationService";
import { ShardFetchPlanner } from "./sync/ShardFetchPlanner";
import { ShardPullService } from "./sync/ShardPullService";
import { ShardRepairService } from "./sync/ShardRepairService";
import { ShardStateService } from "./sync/ShardStateService";
import { SyncDownCoordinator } from "./sync/SyncDownCoordinator";
import {
  NEXUS_INDEX_FILENAME,
  NEXUS_INDEX_V2_FILENAME,
  NEXUS_SHARDS_FILENAME,
} from "./sync/SyncConstants";
import type {
  RepairShardsOptions,
  RepairShardsResult,
  SyncDownResult,
} from "./sync/SyncTypes";

export { DECRYPTION_PENDING_PREFIX } from "./sync/SyncConstants";
export type { RepairShardsOptions, RepairShardsResult } from "./sync/SyncTypes";

type RootResolution = {
  rootGistId: string;
  rootMeta: { updated_at: string };
};

export class SyncService {
  private readonly shardManifestService: ShardManifestService;
  private readonly conflictGuard: ConflictGuard;
  private readonly shardStateService: ShardStateService;
  private readonly shardPullService: ShardPullService;
  private readonly shardRepairService: ShardRepairService;
  private readonly legacyMigrationService: LegacyMigrationService;
  private readonly shardAllocationService: ShardAllocationService;
  private readonly remoteFileSyncService: RemoteFileSyncService;
  private readonly syncDownCoordinator: SyncDownCoordinator;

  constructor(
    private readonly gistRepo: IGistRepository,
    private readonly localStore: ILocalStore,
    fileRepo: IFileRepository,
    cryptoProvider: ICryptoProvider,
  ) {
    this.conflictGuard = new ConflictGuard(gistRepo);
    this.shardStateService = new ShardStateService(gistRepo);

    this.shardManifestService = new ShardManifestService(gistRepo);
    const shardFetchPlanner = new ShardFetchPlanner(gistRepo);

    this.shardAllocationService = new ShardAllocationService({ gistRepo });
    this.remoteFileSyncService = new RemoteFileSyncService({
      gistRepo,
      fileRepo,
      cryptoProvider,
      shardManifestService: this.shardManifestService,
      shardStateService: this.shardStateService,
    });
    this.shardPullService = new ShardPullService({
      gistRepo,
      fileRepo,
      cryptoProvider,
      shardFetchPlanner,
    });
    this.shardRepairService = new ShardRepairService({
      gistRepo,
      localStore,
    });
    this.legacyMigrationService = new LegacyMigrationService({
      gistRepo,
      localStore,
      cryptoProvider,
      shardStateService: this.shardStateService,
      assignStorageForItem: ({ index, categoryId, item, rawContent }) =>
        this.shardAllocationService.assignStorageForItem(
          index,
          categoryId,
          item,
          rawContent,
        ),
      ensureV2Index: (index) => this.ensureV2Index(index),
      hydrateShardCategoryNames: (index) => this.hydrateShardCategoryNames(index),
      byteLength: (content) => this.byteLength(content),
    });
    this.syncDownCoordinator = new SyncDownCoordinator({
      gistRepo,
      localStore,
      shardStateService: this.shardStateService,
      pullShardChanges: (remoteIndex, changedShardGists) =>
        this.pullShardChanges(remoteIndex, changedShardGists),
      migrateLegacyToV2: (legacyGistId, legacyIndexContent) =>
        this.migrateLegacyToV2(legacyGistId, legacyIndexContent),
      resolveAccessibleRootGist: (rootGistId) =>
        this.resolveAccessibleRootGist(rootGistId),
      ensureV2Index: (index) => this.ensureV2Index(index),
      parseShards: (raw, fallback) => this.parseShards(raw, fallback),
      hydrateShardCategoryNames: (index) => this.hydrateShardCategoryNames(index),
      createRootConfigUpdate: (config, rootGistId) =>
        this.createRootConfigUpdate(config, rootGistId),
    });
  }

  async initializeNexus(initialIndex: NexusIndex): Promise<string> {
    const normalized = this.ensureV2Index(initialIndex);
    const gistId = await this.gistRepo.createNexusGist(normalized);
    await this.localStore.saveIndex(normalized);
    return gistId;
  }

  async syncDown(
    config: NexusConfig,
    lastRemoteUpdatedAt: string | null,
  ): Promise<SyncDownResult> {
    return this.syncDownCoordinator.syncDown(config, lastRemoteUpdatedAt);
  }

  async assignStorageForItem(
    _rootGistId: string,
    index: NexusIndex,
    categoryId: string,
    item: GistIndexItem,
    rawContent: string,
  ): Promise<NexusFileStorage> {
    return this.shardAllocationService.assignStorageForItem(
      index,
      categoryId,
      item,
      rawContent,
    );
  }

  async pushIndex(
    gistId: string,
    index: NexusIndex,
    lastKnownRemoteTime: string | null,
    force = false,
  ): Promise<string> {
    if (!force) {
      await this.conflictGuard.assertCanPush(gistId, lastKnownRemoteTime);
    }

    index.updated_at = new Date().toISOString();
    const gistTime =
      (index.version || 1) >= 2
        ? await this.gistRepo.updateBatch(gistId, {
            [NEXUS_INDEX_V2_FILENAME]: JSON.stringify(index, null, 2),
            [NEXUS_SHARDS_FILENAME]: JSON.stringify(index.shards || [], null, 2),
          })
        : await this.gistRepo.updateGistFile(
            gistId,
            NEXUS_INDEX_FILENAME,
            JSON.stringify(index, null, 2),
          );

    await this.localStore.saveIndex(index);
    return gistTime;
  }

  async pushFile(
    rootGistId: string,
    index: NexusIndex,
    fileId: string,
    file: NexusFile,
  ): Promise<string> {
    return this.remoteFileSyncService.pushFile({
      rootGistId,
      index,
      fileId,
      file,
    });
  }

  async deleteRemoteFile(
    rootGistId: string,
    index: NexusIndex,
    fileId: string,
    filename: string,
    storageOverride?: NexusFileStorage,
  ): Promise<string> {
    return this.remoteFileSyncService.deleteRemoteFile({
      rootGistId,
      index,
      fileId,
      filename,
      storageOverride,
    });
  }

  async repairShards(
    rootGistId: string,
    index: NexusIndex,
    options: RepairShardsOptions = {},
  ): Promise<RepairShardsResult> {
    return this.shardRepairService.repair(rootGistId, index, options);
  }

  private async pullShardChanges(
    remoteIndex: NexusIndex,
    changedShardGists: Set<string> | null,
  ): Promise<void> {
    await this.shardPullService.pull({ remoteIndex, changedShardGists });
  }

  private async migrateLegacyToV2(
    legacyGistId: string,
    legacyIndexContent: string,
  ): Promise<{ rootGistId: string; configUpdates: Partial<NexusConfig> }> {
    return this.legacyMigrationService.migrate({
      legacyGistId,
      legacyIndexContent,
    });
  }

  private createRootConfigUpdate(
    config: NexusConfig,
    rootGistId: string,
  ): Partial<NexusConfig> | undefined {
    const updates: Partial<NexusConfig> = {};
    if (config.rootGistId !== rootGistId) {
      updates.rootGistId = rootGistId;
    }
    if (config.gistId !== rootGistId) {
      updates.gistId = rootGistId;
    }
    if ((config.schemaVersion || 1) < 2) {
      updates.schemaVersion = 2;
    }
    return Object.keys(updates).length > 0 ? updates : undefined;
  }

  private async resolveAccessibleRootGist(rootGistId: string): Promise<RootResolution> {
    try {
      const rootMeta = await this.gistRepo.fetchGist(rootGistId);
      return { rootGistId, rootMeta: rootMeta as RootResolution["rootMeta"] };
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
    }

    const discoveredRoot = await this.gistRepo.findNexusGist();
    if (!discoveredRoot) {
      throw new Error(
        `配置的远程 Gist 不存在或无权限访问（${rootGistId}），且未找到可用 Nexus Gist`,
      );
    }

    const rootMeta = await this.gistRepo.fetchGist(discoveredRoot);
    return {
      rootGistId: discoveredRoot,
      rootMeta: rootMeta as RootResolution["rootMeta"],
    };
  }

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const status = (error as { status?: number }).status;
    if (status === 404) {
      return true;
    }

    const message = (error as { message?: string }).message || "";
    return message.includes("Not Found");
  }

  private ensureV2Index(index: NexusIndex): NexusIndex {
    if ((index.version || 1) < 2) {
      index.version = 2;
    }
    index.shards = index.shards || [];
    return index;
  }

  private parseShards(
    raw: string | undefined,
    fallback: ShardDescriptor[],
  ): ShardDescriptor[] {
    if (!raw) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(raw) as ShardDescriptor[];
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (error) {
      console.warn("Failed to parse shard list from root", error);
      return fallback;
    }
  }

  private hydrateShardCategoryNames(index: NexusIndex): void {
    const categoryNames = new Map(
      index.categories.map((category) => [category.id, category.name]),
    );

    for (const shard of index.shards || []) {
      if (shard.kind === "large") {
        shard.categoryName = "Large Files";
        continue;
      }

      if (!shard.categoryName && shard.categoryId) {
        shard.categoryName = categoryNames.get(shard.categoryId) || shard.categoryId;
      }
    }
  }

  private byteLength(content: string): number {
    return new TextEncoder().encode(content).length;
  }
}
