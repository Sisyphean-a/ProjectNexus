import type { IGistRepository } from "../ports/IGistRepository";
import type { ILocalStore } from "../ports/ILocalStore";
import type { IFileRepository } from "../ports/IFileRepository";
import type {
  GistIndexItem,
  NexusConfig,
  NexusFileStorage,
  NexusIndex,
  ShardDescriptor,
  ShardManifest,
  ShardManifestItem,
} from "../../domain/entities/types";
import { NexusFile } from "../../domain/entities/NexusFile";
import { calculateChecksum } from "../../domain/shared/Hash";
import type { ICryptoProvider } from "../ports/ICryptoProvider";
import { ShardManifestService } from "./ShardManifestService";

export const DECRYPTION_PENDING_PREFIX = "__NEXUS_DECRYPT_PENDING__";

const NEXUS_INDEX_FILENAME = "nexus_index.json";
const NEXUS_INDEX_V2_FILENAME = "nexus_index_v2.json";
const NEXUS_SHARDS_FILENAME = "nexus_shards.json";
const SHARD_MANIFEST_FILENAME = "shard_manifest.json";

const SHARD_TARGET_BYTES = 3 * 1024 * 1024;
const SHARD_HARD_BYTES = 8 * 1024 * 1024;
const SHARD_FILE_LIMIT = 120;
const LARGE_FILE_BYTES = 512 * 1024;

interface SyncDownResult {
  index: NexusIndex | null;
  synced: boolean;
  gistUpdatedAt?: string;
  configUpdates?: Partial<NexusConfig>;
}

interface IndexedItem {
  categoryId: string;
  item: GistIndexItem;
}

interface ShardFetchPlan {
  [gistId: string]: Set<string>;
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

export class SyncService {
  private shardManifestService: ShardManifestService;

  constructor(
    private gistRepo: IGistRepository,
    private localStore: ILocalStore,
    private fileRepo: IFileRepository,
    private cryptoProvider: ICryptoProvider,
  ) {
    this.shardManifestService = new ShardManifestService(this.gistRepo);
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
    let rootGistId = config.rootGistId || config.gistId;

    if (!rootGistId) {
      rootGistId = await this.gistRepo.findNexusGist();
      if (!rootGistId) {
        throw new Error("未找到 Nexus Gist，请先初始化");
      }
    }

    const rootMeta = await this.gistRepo.fetchGist(rootGistId);
    const remoteTime = rootMeta.updated_at as string;

    const canSkip =
      lastRemoteUpdatedAt === remoteTime && (config.schemaVersion || 1) >= 2;
    if (canSkip) {
      return {
        index: null,
        synced: false,
        configUpdates: this.createRootConfigUpdate(config, rootGistId),
      };
    }

    const rootFiles = await this.gistRepo.getGistFilesByNames(rootGistId, [
      NEXUS_INDEX_V2_FILENAME,
      NEXUS_SHARDS_FILENAME,
      NEXUS_INDEX_FILENAME,
    ]);

    const v2IndexFile = rootFiles[NEXUS_INDEX_V2_FILENAME];
    const legacyIndexFile = rootFiles[NEXUS_INDEX_FILENAME];

    if (v2IndexFile?.content) {
      const remoteIndex = this.ensureV2Index(
        JSON.parse(v2IndexFile.content) as NexusIndex,
      );
      remoteIndex.shards = this.parseShards(rootFiles[NEXUS_SHARDS_FILENAME]?.content, remoteIndex.shards || []);
      this.hydrateShardCategoryNames(remoteIndex);

      await this.pullShardChanges(remoteIndex);
      await this.localStore.saveIndex(remoteIndex);

      return {
        index: remoteIndex,
        synced: true,
        gistUpdatedAt: remoteTime,
        configUpdates: this.createRootConfigUpdate(config, rootGistId),
      };
    }

    if (!legacyIndexFile?.content) {
      throw new Error("Root Gist 中缺少 index 文件");
    }

    const migrated = await this.migrateLegacyToV2(
      rootGistId,
      legacyIndexFile.content,
    );

    const postMigrationConfig: NexusConfig = {
      ...config,
      gistId: migrated.rootGistId,
      rootGistId: migrated.rootGistId,
      schemaVersion: 2,
      legacyGistId: rootGistId,
    };

    const rerun = await this.syncDown(postMigrationConfig, null);
    rerun.configUpdates = {
      ...(rerun.configUpdates || {}),
      ...migrated.configUpdates,
    };

    return rerun;
  }

  async assignStorageForItem(
    rootGistId: string,
    index: NexusIndex,
    categoryId: string,
    item: GistIndexItem,
    rawContent: string,
  ): Promise<NexusFileStorage> {
    const normalized = this.ensureV2Index(index);
    const contentBytes = this.byteLength(rawContent);

    const shard = await this.selectOrCreateShard(
      rootGistId,
      normalized,
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

  async pushIndex(
    gistId: string,
    index: NexusIndex,
    lastKnownRemoteTime: string | null,
    force = false,
  ): Promise<string> {
    if (!force) {
      try {
        const meta = await this.gistRepo.fetchGist(gistId);
        const remoteTime = new Date(meta.updated_at).getTime();
        const localTime = lastKnownRemoteTime
          ? new Date(lastKnownRemoteTime).getTime()
          : 0;

        if (remoteTime > localTime) {
          throw new Error("检测到同步冲突！远程数据已被其他设备更新。");
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("同步冲突")) {
          throw e;
        }
        console.warn("Conflict check failed, proceeding cautiously", e);
      }
    }

    const now = new Date().toISOString();
    index.updated_at = now;

    let gistTime: string;
    if ((index.version || 1) >= 2) {
      const normalized = this.ensureV2Index(index);
      gistTime = await this.gistRepo.updateBatch(gistId, {
        [NEXUS_INDEX_V2_FILENAME]: JSON.stringify(normalized, null, 2),
        [NEXUS_SHARDS_FILENAME]: JSON.stringify(normalized.shards || [], null, 2),
      });
    } else {
      gistTime = await this.gistRepo.updateGistFile(
        gistId,
        NEXUS_INDEX_FILENAME,
        JSON.stringify(index, null, 2),
      );
    }

    await this.localStore.saveIndex(index);
    return gistTime;
  }

  async pushFile(
    rootGistId: string,
    index: NexusIndex,
    fileId: string,
    file: NexusFile,
  ): Promise<string> {
    const v2 = (index.version || 1) >= 2;

    if (!v2) {
      return this.pushLegacyFile(rootGistId, file);
    }

    const item = this.findItemById(index, fileId)?.item;
    if (!item) {
      throw new Error("Index item not found for file");
    }

    if (!item.storage) {
      throw new Error("V2 index item is missing storage mapping");
    }

    item.gist_file = file.filename;
    item.storage.gist_file = file.filename;

    let contentToPush = file.content;
    if (file.isSecure) {
      if (!this.cryptoProvider.hasPassword()) {
        throw new Error("Vault password not set. Cannot push secure file.");
      }
      contentToPush = await this.cryptoProvider.encrypt(file.content);
    }

    const contentTime = await this.gistRepo.updateGistFile(
      item.storage.gistId,
      item.storage.gist_file,
      contentToPush,
    );

    await this.shardManifestService.upsert(index, item, file, contentTime);

    file.markClean();
    await this.fileRepo.save(file);

    return contentTime;
  }

  async deleteRemoteFile(
    rootGistId: string,
    index: NexusIndex,
    fileId: string,
    filename: string,
    storageOverride?: NexusFileStorage,
  ): Promise<string> {
    const v2 = (index.version || 1) >= 2;

    if (!v2) {
      return this.gistRepo.updateGistFile(rootGistId, filename, null);
    }

    if (storageOverride) {
      const deletionTime = await this.gistRepo.updateGistFile(
        storageOverride.gistId,
        filename,
        null,
      );
      await this.shardManifestService.removeByStorage(
        index,
        fileId,
        storageOverride,
      );
      return deletionTime;
    }

    const item = this.findItemById(index, fileId)?.item;
    if (!item?.storage) {
      return this.gistRepo.updateGistFile(rootGistId, filename, null);
    }

    const deletionTime = await this.gistRepo.updateGistFile(
      item.storage.gistId,
      item.storage.gist_file,
      null,
    );

    await this.shardManifestService.removeByItem(index, item);
    return deletionTime;
  }

  async repairShards(
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
    const dedupedByGist = new Map<string, ShardDescriptor>();
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

      const existing = dedupedByGist.get(normalizedShard.gistId);
      if (existing) {
        duplicateRowsMerged += 1;
        dedupedByGist.set(
          normalizedShard.gistId,
          this.mergeShardDescriptor(existing, normalizedShard),
        );
      } else {
        dedupedByGist.set(normalizedShard.gistId, normalizedShard);
      }
    }

    const fileById = this.buildItemMapById(normalized);
    const categoryNameById = new Map<string, string>();
    for (const category of normalized.categories) {
      categoryNameById.set(category.id, category.name);
    }

    const repairedShards: ShardDescriptor[] = [];
    const removableShardGists: string[] = [];
    let manifestsLoaded = 0;

    for (const shard of dedupedByGist.values()) {
      const manifest = await this.gistRepo.fetchShardManifest(shard.gistId);
      if (manifest) {
        manifestsLoaded += 1;
      }

      const linkedFileIds = new Set<string>();
      for (const [fileId, ref] of fileById.entries()) {
        const storage = ref.item.storage;
        if (!storage) continue;
        if (storage.gistId === shard.gistId || storage.shardId === shard.id) {
          linkedFileIds.add(fileId);
        }
      }

      const manifestFiles = manifest?.files || [];
      const manifestByFileId = new Map<string, ShardManifestItem>();
      for (const row of manifestFiles) {
        manifestByFileId.set(row.fileId, row);
      }

      let categoryId = shard.categoryId;
      if (!categoryId && shard.kind === "category") {
        const categories = new Set<string>();
        for (const linkedId of linkedFileIds) {
          const ref = fileById.get(linkedId);
          if (ref) categories.add(ref.categoryId);
        }
        if (categories.size === 1) {
          categoryId = Array.from(categories)[0];
        }
      }

      const categoryName =
        shard.kind === "large"
          ? "Large Files"
          : categoryId
            ? (categoryNameById.get(categoryId) || categoryId)
            : (shard.categoryName || "Unknown Category");

      const filesForStats: ShardManifestItem[] = linkedFileIds.size > 0
        ? Array.from(linkedFileIds)
            .map((fileId) => manifestByFileId.get(fileId))
            .filter((x): x is ShardManifestItem => !!x)
        : manifestFiles;

      const linkedCount = linkedFileIds.size;
      const manifestCount = manifestFiles.length;
      const totalBytes = filesForStats.reduce((sum, f) => sum + (f.size || 0), 0);
      const orphanManifestEntries = manifestFiles.filter(
        (f) => !fileById.has(f.fileId),
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

      const emptyAndUnused = linkedCount === 0 && manifestCount === 0;
      if (dropEmptyShards && emptyAndUnused) {
        removableShardGists.push(shard.gistId);
        continue;
      }

      repairedShards.push(repaired);

      if (apply && rewriteReadme) {
        await this.gistRepo.updateGistFile(
          repaired.gistId,
          "README.md",
          this.buildShardReadme(
            repaired,
            linkedCount,
            manifestCount,
            totalBytes,
            orphanManifestEntries,
          ),
        );
      }

      if (apply && rewriteDescription) {
        await this.gistRepo.updateGistDescription(
          repaired.gistId,
          this.buildShardDescription(repaired),
        );
      }
    }

    repairedShards.sort((a, b) => {
      const ka = `${a.kind}:${a.categoryName || ""}:${a.part}`;
      const kb = `${b.kind}:${b.categoryName || ""}:${b.part}`;
      return ka.localeCompare(kb);
    });

    let rootUpdatedAt: string | undefined;
    const deletedShardGistIds: string[] = [];
    let deletedLegacyGistId: string | undefined;
    const sweptShardGistIds: string[] = [];

    if (apply) {
      normalized.shards = repairedShards;
      normalized.updated_at = new Date().toISOString();
      rootUpdatedAt = await this.gistRepo.updateBatch(rootGistId, {
        [NEXUS_INDEX_V2_FILENAME]: JSON.stringify(normalized, null, 2),
        [NEXUS_SHARDS_FILENAME]: JSON.stringify(repairedShards, null, 2),
      });
      await this.localStore.saveIndex(normalized);

      if (deleteOrphanGists) {
        const uniqueGists = Array.from(new Set(removableShardGists));
        for (const gistId of uniqueGists) {
          await this.gistRepo.deleteGist(gistId);
          deletedShardGistIds.push(gistId);
        }
      }

      if (sweepUnreferencedShardGists) {
        const allShardGists = await this.gistRepo.listAllShardGistIds();
        const keep = new Set<string>([
          rootGistId,
          ...repairedShards.map((s) => s.gistId),
        ]);

        for (const gistId of allShardGists) {
          if (keep.has(gistId)) continue;
          if (deletedShardGistIds.includes(gistId)) continue;
          await this.gistRepo.deleteGist(gistId);
          sweptShardGistIds.push(gistId);
        }
      }

      if (
        legacyGistIdToDelete &&
        legacyGistIdToDelete !== rootGistId &&
        !deletedShardGistIds.includes(legacyGistIdToDelete) &&
        !sweptShardGistIds.includes(legacyGistIdToDelete)
      ) {
        try {
          await this.gistRepo.deleteGist(legacyGistIdToDelete);
          deletedLegacyGistId = legacyGistIdToDelete;
        } catch (e) {
          console.warn(
            `[SyncService] Failed to delete legacy gist ${legacyGistIdToDelete}`,
            e,
          );
        }
      }
    }

    return {
      applied: apply,
      rawShardCount: rawShards.length,
      dedupedShardCount: dedupedByGist.size,
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

  private async pushLegacyFile(gistId: string, file: NexusFile): Promise<string> {
    let contentToPush = file.content;
    if (file.isSecure) {
      if (!this.cryptoProvider.hasPassword()) {
        throw new Error("Vault password not set. Cannot push secure file.");
      }
      contentToPush = await this.cryptoProvider.encrypt(file.content);
    }

    const newTime = await this.gistRepo.updateGistFile(
      gistId,
      file.filename,
      contentToPush,
    );
    file.markClean();
    await this.fileRepo.save(file);
    return newTime;
  }

  private async pullShardChanges(remoteIndex: NexusIndex): Promise<void> {
    const itemById = this.buildItemMapById(remoteIndex);
    const itemByStorageKey = this.buildItemMapByStorageKey(remoteIndex);

    const filesToFetch: ShardFetchPlan = {};
    const manifestsByShard = new Map<string, ShardManifest>();

    for (const shard of remoteIndex.shards || []) {
      const manifest = await this.gistRepo.fetchShardManifest(shard.gistId);
      if (!manifest) {
        continue;
      }

      manifestsByShard.set(shard.gistId, manifest);
      this.reconcileShardDescriptorWithManifest(remoteIndex, shard, manifest, itemById);

      for (const manifestItem of manifest.files) {
        const indexed = itemById.get(manifestItem.fileId);
        if (!indexed) continue;

        if (!indexed.item.storage) {
          indexed.item.storage = {
            shardId: shard.id,
            gistId: shard.gistId,
            gist_file: manifestItem.filename,
          };
          indexed.item.gist_file = manifestItem.filename;
        }

        const localFile = await this.fileRepo.get(indexed.item.id);
        if (!localFile || localFile.checksum !== manifestItem.checksum) {
          if (!filesToFetch[shard.gistId]) {
            filesToFetch[shard.gistId] = new Set<string>();
          }
          filesToFetch[shard.gistId].add(manifestItem.filename);
        }
      }
    }

    const upsertFiles: NexusFile[] = [];
    const conflictFiles: NexusFile[] = [];

    for (const shard of remoteIndex.shards || []) {
      const manifest = manifestsByShard.get(shard.gistId);

      if (!manifest) {
        const fullFiles = await this.gistRepo.getGistContent(shard.gistId);
        for (const [filename, gistFile] of Object.entries(fullFiles)) {
          if (filename === SHARD_MANIFEST_FILENAME || filename === "README.md") {
            continue;
          }

          const indexed =
            itemByStorageKey.get(`${shard.gistId}::${filename}`) ||
            this.findIndexedItemByLegacyFilename(remoteIndex, filename);
          if (!indexed) continue;

          await this.buildUpsertFile(
            indexed.item,
            gistFile.content,
            gistFile.updated_at || new Date().toISOString(),
            upsertFiles,
            conflictFiles,
          );
        }

        continue;
      }

      const needSet = filesToFetch[shard.gistId];
      if (!needSet || needSet.size === 0) {
        continue;
      }

      const requestedFiles = Array.from(needSet);
      const fetched = await this.gistRepo.getGistFilesByNames(
        shard.gistId,
        requestedFiles,
      );

      const manifestByFilename = new Map<string, ShardManifestItem>();
      for (const m of manifest.files) {
        manifestByFilename.set(m.filename, m);
      }

      for (const [filename, gistFile] of Object.entries(fetched)) {
        const indexed = itemByStorageKey.get(`${shard.gistId}::${filename}`);
        if (!indexed) continue;

        const manifestItem = manifestByFilename.get(filename);
        const updatedAt = manifestItem?.updated_at || gistFile.updated_at || new Date().toISOString();
        await this.buildUpsertFile(
          indexed.item,
          gistFile.content,
          updatedAt,
          upsertFiles,
          conflictFiles,
        );
      }
    }

    if (upsertFiles.length > 0 || conflictFiles.length > 0) {
      await this.fileRepo.saveBulk([...upsertFiles, ...conflictFiles]);
    }
  }

  private async buildUpsertFile(
    item: GistIndexItem,
    remoteContentRaw: string,
    remoteUpdatedAt: string,
    upsertFiles: NexusFile[],
    conflictFiles: NexusFile[],
  ): Promise<void> {
    let finalRemoteContent = remoteContentRaw;

    if (item.isSecure) {
      try {
        finalRemoteContent = await this.cryptoProvider.decrypt(remoteContentRaw);
      } catch (e) {
        console.error(`Failed to decrypt ${item.gist_file}`, e);
        finalRemoteContent = DECRYPTION_PENDING_PREFIX + remoteContentRaw;
      }
    }

    const remoteChecksum = calculateChecksum(finalRemoteContent);
    const localFile = await this.fileRepo.get(item.id);

    if (localFile && localFile.isDirty && localFile.checksum !== remoteChecksum) {
      const conflictId = `${item.id}_conflict_${Date.now().toString(36)}`;
      const conflictFile = new NexusFile(
        conflictId,
        `${item.title} (Conflict)`,
        localFile.content,
        localFile.language,
        localFile.tags,
        localFile.updatedAt,
        true,
        localFile.checksum,
        localFile.lastSyncedAt,
        localFile.isSecure,
      );
      conflictFiles.push(conflictFile);
    }

    const nexusFile = new NexusFile(
      item.id,
      item.title,
      finalRemoteContent,
      item.language,
      item.tags || [],
      remoteUpdatedAt,
      false,
      remoteChecksum,
      remoteUpdatedAt,
      !!item.isSecure,
    );

    upsertFiles.push(nexusFile);
  }

  private async migrateLegacyToV2(
    legacyGistId: string,
    legacyIndexContent: string,
  ): Promise<{ rootGistId: string; configUpdates: Partial<NexusConfig> }> {
    const legacyIndex = JSON.parse(legacyIndexContent) as NexusIndex;
    const legacyFiles = await this.gistRepo.getGistContent(legacyGistId);

    const migratedIndex: NexusIndex = this.ensureV2Index({
      version: 2,
      updated_at: new Date().toISOString(),
      categories: legacyIndex.categories.map((cat) => ({
        ...cat,
        items: [],
      })),
      shards: [],
    });
    this.hydrateShardCategoryNames(migratedIndex);

    const rootGistId = await this.gistRepo.createNexusGist(migratedIndex);

    const filesByShard = new Map<string, Record<string, string>>();
    const manifestByShard = new Map<string, ShardManifest>();

    for (const category of legacyIndex.categories) {
      const targetCategory = migratedIndex.categories.find((c) => c.id === category.id);
      if (!targetCategory) continue;

      for (const item of category.items) {
        const remoteFile = legacyFiles[item.gist_file];
        const remoteContent = remoteFile?.content || "";

        const migratedItem: GistIndexItem = {
          ...item,
          gist_file: item.gist_file,
        };

        const storage = await this.assignStorageForItem(
          rootGistId,
          migratedIndex,
          category.id,
          migratedItem,
          remoteContent,
        );

        const shardDescriptor = (migratedIndex.shards || []).find(
          (s) => s.id === storage.shardId,
        );
        if (shardDescriptor) {
          shardDescriptor.fileCount += 1;
          shardDescriptor.totalBytes += this.byteLength(remoteContent);
          shardDescriptor.updated_at = new Date().toISOString();
        }

        targetCategory.items.push(migratedItem);

        const shardFiles = filesByShard.get(storage.gistId) || {};
        shardFiles[storage.gist_file] = remoteContent;
        filesByShard.set(storage.gistId, shardFiles);

        const manifest =
          manifestByShard.get(storage.gistId) ||
          ({
            version: 1,
            shardId: storage.shardId,
            updated_at: new Date().toISOString(),
            files: [],
          } as ShardManifest);

        let checksumBase = remoteContent;
        if (migratedItem.isSecure && this.cryptoProvider.hasPassword()) {
          try {
            checksumBase = await this.cryptoProvider.decrypt(remoteContent);
          } catch (e) {
            console.warn(
              `[SyncService] Failed to decrypt secure file during migration: ${migratedItem.gist_file}`,
              e,
            );
          }
        }

        manifest.files.push({
          fileId: migratedItem.id,
          filename: storage.gist_file,
          checksum: calculateChecksum(checksumBase),
          updated_at: new Date().toISOString(),
          size: this.byteLength(remoteContent),
          isSecure: !!migratedItem.isSecure,
        });

        manifestByShard.set(storage.gistId, manifest);
      }
    }

    for (const [gistId, files] of filesByShard.entries()) {
      const manifest = manifestByShard.get(gistId);
      if (!manifest) continue;

      await this.gistRepo.updateBatch(gistId, {
        ...files,
        [SHARD_MANIFEST_FILENAME]: JSON.stringify(manifest, null, 2),
      });
    }

    migratedIndex.updated_at = new Date().toISOString();

    await this.gistRepo.updateBatch(rootGistId, {
      [NEXUS_INDEX_V2_FILENAME]: JSON.stringify(migratedIndex, null, 2),
      [NEXUS_SHARDS_FILENAME]: JSON.stringify(migratedIndex.shards || [], null, 2),
    });

    await this.localStore.saveIndex(migratedIndex);

    return {
      rootGistId,
      configUpdates: {
        rootGistId,
        gistId: rootGistId,
        legacyGistId,
        schemaVersion: 2,
      },
    };
  }

  private async selectOrCreateShard(
    rootGistId: string,
    index: NexusIndex,
    categoryId: string,
    contentBytes: number,
  ): Promise<ShardDescriptor> {
    const kind: "category" | "large" =
      contentBytes > LARGE_FILE_BYTES ? "large" : "category";

    const candidates = (index.shards || [])
      .filter((s) => {
        if (kind === "large") return s.kind === "large";
        return s.kind === "category" && s.categoryId === categoryId;
      })
      .sort((a, b) => a.part - b.part);

    let selected = candidates.find(
      (s) =>
        s.fileCount + 1 <= SHARD_FILE_LIMIT &&
        s.totalBytes + contentBytes <= SHARD_TARGET_BYTES,
    );

    if (!selected) {
      selected = candidates.find(
        (s) =>
          s.fileCount + 1 <= SHARD_FILE_LIMIT &&
          s.totalBytes + contentBytes <= SHARD_HARD_BYTES,
      );
    }

    if (selected) {
      return selected;
    }

    const part = candidates.length > 0 ? Math.max(...candidates.map((s) => s.part)) + 1 : 1;
    const shardId =
      kind === "large"
        ? `large-part-${part}`
        : `cat-${this.normalizeId(categoryId)}-part-${part}`;
    const categoryName =
      kind === "large"
        ? "Large Files"
        : index.categories.find((c) => c.id === categoryId)?.name || categoryId;

    const gistId = await this.gistRepo.createShardGist(
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

    if (!index.shards) {
      index.shards = [];
    }
    index.shards.push(descriptor);

    return descriptor;
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

  private ensureV2Index(index: NexusIndex): NexusIndex {
    if ((index.version || 1) >= 2) {
      if (!index.shards) {
        index.shards = [];
      }
      return index;
    }

    index.version = 2;
    if (!index.shards) {
      index.shards = [];
    }
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
    } catch (e) {
      console.warn("Failed to parse shard list from root", e);
      return fallback;
    }
  }

  private hydrateShardCategoryNames(index: NexusIndex): void {
    const byId = new Map<string, string>();
    for (const category of index.categories) {
      byId.set(category.id, category.name);
    }

    for (const shard of index.shards || []) {
      if (shard.kind === "large") {
        shard.categoryName = "Large Files";
        continue;
      }

      if (!shard.categoryName && shard.categoryId) {
        shard.categoryName = byId.get(shard.categoryId) || shard.categoryId;
      }
    }
  }

  private reconcileShardDescriptorWithManifest(
    index: NexusIndex,
    shard: ShardDescriptor,
    manifest: ShardManifest,
    itemById: Map<string, IndexedItem>,
  ): void {
    let count = 0;
    let totalBytes = 0;

    for (const manifestItem of manifest.files) {
      const indexed = itemById.get(manifestItem.fileId);
      if (!indexed) {
        continue;
      }

      if (indexed.item.storage && indexed.item.storage.shardId !== shard.id) {
        continue;
      }

      count += 1;
      totalBytes += manifestItem.size || 0;
    }

    shard.fileCount = count;
    shard.totalBytes = totalBytes;
    shard.updated_at = manifest.updated_at || shard.updated_at;
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

  private buildItemMapByStorageKey(index: NexusIndex): Map<string, IndexedItem> {
    const map = new Map<string, IndexedItem>();
    for (const category of index.categories) {
      for (const item of category.items) {
        if (!item.storage) continue;
        map.set(`${item.storage.gistId}::${item.storage.gist_file}`, {
          categoryId: category.id,
          item,
        });
      }
    }
    return map;
  }

  private findItemById(index: NexusIndex, fileId: string): IndexedItem | null {
    for (const category of index.categories) {
      const item = category.items.find((i) => i.id === fileId);
      if (item) {
        return { categoryId: category.id, item };
      }
    }
    return null;
  }

  private findIndexedItemByLegacyFilename(
    index: NexusIndex,
    filename: string,
  ): IndexedItem | null {
    for (const category of index.categories) {
      const item = category.items.find((i) => i.gist_file === filename);
      if (item) {
        return { categoryId: category.id, item };
      }
    }
    return null;
  }

  private normalizeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36);
  }

  private inferPart(value: string | undefined): number {
    if (!value) return 1;
    const match = value.match(/part-(\d+)/i);
    if (!match) return 1;
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
      updated_at: base.updated_at || incoming.updated_at || new Date().toISOString(),
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

  private byteLength(content: string): number {
    return new TextEncoder().encode(content).length;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}
