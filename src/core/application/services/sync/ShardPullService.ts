import { NexusFile } from "../../../domain/entities/NexusFile";
import type {
  GistIndexItem,
  NexusIndex,
  ShardDescriptor,
  ShardManifest,
  ShardManifestItem,
} from "../../../domain/entities/types";
import type { ICryptoProvider } from "../../ports/ICryptoProvider";
import type { IFileRepository } from "../../ports/IFileRepository";
import type { IGistRepository } from "../../ports/IGistRepository";
import {
  SHARD_FETCH_CONCURRENCY,
  SHARD_MANIFEST_FILENAME,
} from "./SyncConstants";
import { ShardFetchPlanner } from "./ShardFetchPlanner";
import { ShardUpsertService } from "./ShardUpsertService";
import type { IndexedItem, ShardFetchPlan } from "./SyncTypes";

interface PullOptions {
  remoteIndex: NexusIndex;
  changedShardGists: Set<string> | null;
}

interface PullDependencies {
  gistRepo: Pick<IGistRepository, "getGistContent">;
  fileRepo: Pick<IFileRepository, "get" | "saveBulk">;
  cryptoProvider: Pick<ICryptoProvider, "decrypt">;
  shardFetchPlanner: Pick<ShardFetchPlanner, "fetchFilesByShard" | "fetchManifests">;
  upsertService?: ShardUpsertService;
  now?: () => string;
}

export class ShardPullService {
  private readonly now: () => string;
  private readonly upsertService: ShardUpsertService;

  constructor(private readonly deps: PullDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.upsertService =
      deps.upsertService
      || new ShardUpsertService({
        fileRepo: deps.fileRepo,
        cryptoProvider: deps.cryptoProvider,
      });
  }

  async pull(options: PullOptions): Promise<void> {
    const { itemById, itemByStorageKey } = this.upsertService.createLookupMaps(
      options.remoteIndex,
    );
    const shardsToSync = this.selectShardsToSync(
      options.remoteIndex.shards || [],
      options.changedShardGists,
    );
    const filesToFetch: ShardFetchPlan = {};
    const manifestsByShard = await this.fetchManifestMap(shardsToSync);

    await this.collectManifestFetches(
      shardsToSync,
      manifestsByShard,
      itemById,
      filesToFetch,
    );

    const upsertFiles: NexusFile[] = [];
    const conflictFiles: NexusFile[] = [];

    await this.pullLegacyShardFiles(
      shardsToSync,
      manifestsByShard,
      itemByStorageKey,
      options.remoteIndex,
      upsertFiles,
      conflictFiles,
    );
    await this.pullManifestFiles(
      manifestsByShard,
      itemByStorageKey,
      filesToFetch,
      upsertFiles,
      conflictFiles,
    );

    if (upsertFiles.length === 0 && conflictFiles.length === 0) {
      return;
    }

    await this.deps.fileRepo.saveBulk([...upsertFiles, ...conflictFiles]);
  }

  private selectShardsToSync(
    shards: readonly ShardDescriptor[],
    changedShardGists: Set<string> | null,
  ): ShardDescriptor[] {
    return shards.filter(
      (shard) => !changedShardGists || changedShardGists.has(shard.gistId),
    );
  }

  private async fetchManifestMap(
    shardsToSync: readonly ShardDescriptor[],
  ): Promise<Map<string, ShardManifest | null>> {
    const manifestEntries = await this.deps.shardFetchPlanner.fetchManifests(
      shardsToSync.map((shard) => shard.gistId),
      SHARD_FETCH_CONCURRENCY,
    );

    return new Map(
      manifestEntries.map((entry) => [entry.gistId, entry.manifest]),
    );
  }

  private async collectManifestFetches(
    shardsToSync: readonly ShardDescriptor[],
    manifestsByShard: ReadonlyMap<string, ShardManifest | null>,
    itemById: ReadonlyMap<string, IndexedItem>,
    filesToFetch: ShardFetchPlan,
  ): Promise<void> {
    for (const shard of shardsToSync) {
      const manifest = manifestsByShard.get(shard.gistId);
      if (!manifest) {
        continue;
      }

      this.reconcileShardDescriptorWithManifest(shard, manifest, itemById);
      await this.queueManifestFiles(shard, manifest, itemById, filesToFetch);
    }
  }

  private async queueManifestFiles(
    shard: ShardDescriptor,
    manifest: ShardManifest,
    itemById: ReadonlyMap<string, IndexedItem>,
    filesToFetch: ShardFetchPlan,
  ): Promise<void> {
    for (const manifestItem of manifest.files) {
      const indexed = itemById.get(manifestItem.fileId);
      if (!indexed) {
        continue;
      }

      this.hydrateStorage(indexed.item, shard, manifestItem.filename);

      const localFile = await this.deps.fileRepo.get(indexed.item.id);
      if (localFile && localFile.checksum === manifestItem.checksum) {
        continue;
      }

      if (!filesToFetch[shard.gistId]) {
        filesToFetch[shard.gistId] = new Set<string>();
      }
      filesToFetch[shard.gistId].add(manifestItem.filename);
    }
  }

  private hydrateStorage(
    item: GistIndexItem,
    shard: ShardDescriptor,
    filename: string,
  ): void {
    if (item.storage) {
      return;
    }

    item.storage = {
      shardId: shard.id,
      gistId: shard.gistId,
      gist_file: filename,
    };
    item.gist_file = filename;
  }

  private async pullLegacyShardFiles(
    shardsToSync: readonly ShardDescriptor[],
    manifestsByShard: ReadonlyMap<string, ShardManifest | null>,
    itemByStorageKey: ReadonlyMap<string, IndexedItem>,
    remoteIndex: NexusIndex,
    upsertFiles: NexusFile[],
    conflictFiles: NexusFile[],
  ): Promise<void> {
    for (const shard of shardsToSync) {
      if (manifestsByShard.get(shard.gistId)) {
        continue;
      }

      const fullFiles = await this.deps.gistRepo.getGistContent(shard.gistId);
      for (const [filename, gistFile] of Object.entries(fullFiles)) {
        if (this.isMetadataFile(filename)) {
          continue;
        }

        const indexed = this.resolveIndexedItem(
          shard.gistId,
          filename,
          itemByStorageKey,
          remoteIndex,
        );
        if (!indexed) {
          continue;
        }

        await this.upsertService.appendUpsertFile({
          item: indexed.item,
          remoteContentRaw: gistFile.content,
          remoteUpdatedAt: gistFile.updated_at || this.now(),
          upsertFiles,
          conflictFiles,
        });
      }
    }
  }

  private async pullManifestFiles(
    manifestsByShard: ReadonlyMap<string, ShardManifest | null>,
    itemByStorageKey: ReadonlyMap<string, IndexedItem>,
    filesToFetch: ShardFetchPlan,
    upsertFiles: NexusFile[],
    conflictFiles: NexusFile[],
  ): Promise<void> {
    const requestedFiles = Object.entries(filesToFetch).map(([gistId, filenames]) => ({
      gistId,
      filenames: Array.from(filenames),
    }));
    const fetchedGroups = await this.deps.shardFetchPlanner.fetchFilesByShard(
      requestedFiles,
      SHARD_FETCH_CONCURRENCY,
    );

    for (const group of fetchedGroups) {
      const manifest = manifestsByShard.get(group.gistId);
      if (!manifest) {
        continue;
      }

      const manifestByFilename = this.buildManifestByFilename(manifest);
      for (const [filename, gistFile] of Object.entries(group.files)) {
        const indexed = itemByStorageKey.get(`${group.gistId}::${filename}`);
        if (!indexed) {
          continue;
        }

        await this.upsertService.appendUpsertFile({
          item: indexed.item,
          remoteContentRaw: gistFile.content,
          remoteUpdatedAt:
            manifestByFilename.get(filename)?.updated_at
            || gistFile.updated_at
            || this.now(),
          upsertFiles,
          conflictFiles,
        });
      }
    }
  }

  private buildManifestByFilename(
    manifest: ShardManifest,
  ): Map<string, ShardManifestItem> {
    const manifestByFilename = new Map<string, ShardManifestItem>();
    for (const row of manifest.files) {
      manifestByFilename.set(row.filename, row);
    }
    return manifestByFilename;
  }

  private isMetadataFile(filename: string): boolean {
    return filename === SHARD_MANIFEST_FILENAME || filename === "README.md";
  }

  private resolveIndexedItem(
    gistId: string,
    filename: string,
    itemByStorageKey: ReadonlyMap<string, IndexedItem>,
    remoteIndex: NexusIndex,
  ): IndexedItem | null {
    return (
      itemByStorageKey.get(`${gistId}::${filename}`)
      || this.upsertService.findIndexedItemByLegacyFilename(remoteIndex, filename)
    );
  }

  private reconcileShardDescriptorWithManifest(
    shard: ShardDescriptor,
    manifest: ShardManifest,
    itemById: ReadonlyMap<string, IndexedItem>,
  ): void {
    let fileCount = 0;
    let totalBytes = 0;

    for (const manifestItem of manifest.files) {
      const indexed = itemById.get(manifestItem.fileId);
      if (!indexed) {
        continue;
      }
      if (indexed.item.storage && indexed.item.storage.shardId !== shard.id) {
        continue;
      }

      fileCount += 1;
      totalBytes += manifestItem.size || 0;
    }

    shard.fileCount = fileCount;
    shard.totalBytes = totalBytes;
    shard.updated_at = manifest.updated_at || shard.updated_at;
  }
}
