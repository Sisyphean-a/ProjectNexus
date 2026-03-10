import type { ICryptoProvider } from "../../ports/ICryptoProvider";
import type { IGistRepository } from "../../ports/IGistRepository";
import type { ILocalStore } from "../../ports/ILocalStore";
import type {
  GistIndexItem,
  NexusConfig,
  NexusFileStorage,
  NexusIndex,
  ShardManifest,
} from "../../../domain/entities/types";
import { calculateChecksum } from "../../../domain/shared/Hash";
import {
  NEXUS_INDEX_V2_FILENAME,
  NEXUS_SHARDS_FILENAME,
  NEXUS_SHARD_STATE_FILENAME,
  SHARD_MANIFEST_FILENAME,
} from "./SyncConstants";
import { ShardStateService } from "./ShardStateService";

interface AssignStorageOptions {
  rootGistId: string;
  index: NexusIndex;
  categoryId: string;
  item: GistIndexItem;
  rawContent: string;
}

interface LegacyMigrationOptions {
  legacyGistId: string;
  legacyIndexContent: string;
}

interface LegacyMigrationDependencies {
  gistRepo: Pick<IGistRepository, "createNexusGist" | "getGistContent" | "updateBatch">;
  localStore: Pick<ILocalStore, "saveIndex">;
  cryptoProvider: Pick<ICryptoProvider, "decrypt" | "hasPassword">;
  shardStateService: Pick<ShardStateService, "buildShardStateForRoot">;
  assignStorageForItem(
    options: AssignStorageOptions,
  ): Promise<NexusFileStorage>;
  ensureV2Index(index: NexusIndex): NexusIndex;
  hydrateShardCategoryNames(index: NexusIndex): void;
  byteLength(content: string): number;
  now?: () => string;
}

export class LegacyMigrationService {
  private readonly now: () => string;

  constructor(private readonly deps: LegacyMigrationDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async migrate(
    options: LegacyMigrationOptions,
  ): Promise<{ rootGistId: string; configUpdates: Partial<NexusConfig> }> {
    const legacyIndex = JSON.parse(options.legacyIndexContent) as NexusIndex;
    const legacyFiles = await this.deps.gistRepo.getGistContent(options.legacyGistId);
    const migratedIndex = this.createMigratedIndex(legacyIndex);
    const rootGistId = await this.deps.gistRepo.createNexusGist(migratedIndex);
    const filesByShard = new Map<string, Record<string, string>>();
    const manifestByShard = new Map<string, ShardManifest>();

    for (const category of legacyIndex.categories) {
      const targetCategory = migratedIndex.categories.find(
        (candidate) => candidate.id === category.id,
      );
      if (!targetCategory) {
        continue;
      }

      for (const item of category.items) {
        await this.migrateItem(
          rootGistId,
          migratedIndex,
          targetCategory.items,
          category.id,
          item,
          legacyFiles[item.gist_file]?.content || "",
          filesByShard,
          manifestByShard,
        );
      }
    }

    await this.persistShardFiles(filesByShard, manifestByShard);
    await this.persistRootIndex(rootGistId, migratedIndex, manifestByShard);

    return {
      rootGistId,
      configUpdates: {
        rootGistId,
        gistId: rootGistId,
        legacyGistId: options.legacyGistId,
        schemaVersion: 2,
      },
    };
  }

  private createMigratedIndex(legacyIndex: NexusIndex): NexusIndex {
    const migratedIndex = this.deps.ensureV2Index({
      version: 2,
      updated_at: this.now(),
      categories: legacyIndex.categories.map((category) => ({
        ...category,
        items: [],
      })),
      shards: [],
    });

    this.deps.hydrateShardCategoryNames(migratedIndex);
    return migratedIndex;
  }

  private async migrateItem(
    rootGistId: string,
    migratedIndex: NexusIndex,
    targetItems: GistIndexItem[],
    categoryId: string,
    item: GistIndexItem,
    remoteContent: string,
    filesByShard: Map<string, Record<string, string>>,
    manifestByShard: Map<string, ShardManifest>,
  ): Promise<void> {
    const migratedItem: GistIndexItem = {
      ...item,
      gist_file: item.gist_file,
    };
    const storage = await this.deps.assignStorageForItem({
      rootGistId,
      index: migratedIndex,
      categoryId,
      item: migratedItem,
      rawContent: remoteContent,
    });
    const shardDescriptor = (migratedIndex.shards || []).find(
      (shard) => shard.id === storage.shardId,
    );

    if (shardDescriptor) {
      shardDescriptor.fileCount += 1;
      shardDescriptor.totalBytes += this.deps.byteLength(remoteContent);
      shardDescriptor.updated_at = this.now();
    }

    targetItems.push(migratedItem);
    const shardFiles = filesByShard.get(storage.gistId) || {};
    shardFiles[storage.gist_file] = remoteContent;
    filesByShard.set(storage.gistId, shardFiles);

    const manifest = manifestByShard.get(storage.gistId) || this.createManifest(storage);
    manifest.files.push({
      fileId: migratedItem.id,
      filename: storage.gist_file,
      checksum: calculateChecksum(
        await this.resolveChecksumBase(migratedItem, remoteContent),
      ),
      updated_at: this.now(),
      size: this.deps.byteLength(remoteContent),
      isSecure: !!migratedItem.isSecure,
    });
    manifestByShard.set(storage.gistId, manifest);
  }

  private createManifest(storage: NexusFileStorage): ShardManifest {
    return {
      version: 1,
      shardId: storage.shardId,
      updated_at: this.now(),
      files: [],
    };
  }

  private async resolveChecksumBase(
    item: GistIndexItem,
    remoteContent: string,
  ): Promise<string> {
    if (!item.isSecure || !this.deps.cryptoProvider.hasPassword()) {
      return remoteContent;
    }

    try {
      return await this.deps.cryptoProvider.decrypt(remoteContent);
    } catch (error) {
      console.warn(
        `[SyncService] Failed to decrypt secure file during migration: ${item.gist_file}`,
        error,
      );
      return remoteContent;
    }
  }

  private async persistShardFiles(
    filesByShard: Map<string, Record<string, string>>,
    manifestByShard: Map<string, ShardManifest>,
  ): Promise<void> {
    for (const [gistId, files] of filesByShard.entries()) {
      const manifest = manifestByShard.get(gistId);
      if (!manifest) {
        continue;
      }

      await this.deps.gistRepo.updateBatch(gistId, {
        ...files,
        [SHARD_MANIFEST_FILENAME]: JSON.stringify(manifest, null, 2),
      });
    }
  }

  private async persistRootIndex(
    rootGistId: string,
    migratedIndex: NexusIndex,
    manifestByShard: Map<string, ShardManifest>,
  ): Promise<void> {
    migratedIndex.updated_at = this.now();
    const shardState = this.deps.shardStateService.buildShardStateForRoot(
      migratedIndex,
      manifestByShard,
    );

    await this.deps.gistRepo.updateBatch(rootGistId, {
      [NEXUS_INDEX_V2_FILENAME]: JSON.stringify(migratedIndex, null, 2),
      [NEXUS_SHARDS_FILENAME]: JSON.stringify(migratedIndex.shards || [], null, 2),
      [NEXUS_SHARD_STATE_FILENAME]: JSON.stringify(shardState, null, 2),
    });
    await this.deps.localStore.saveIndex(migratedIndex);
  }
}
