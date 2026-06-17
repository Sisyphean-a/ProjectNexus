import { NexusFile } from "../../../domain/entities/NexusFile";
import type { GistIndexItem, NexusIndex } from "../../../domain/entities/types";
import { calculateChecksum } from "../../../domain/shared/Hash";
import type { ICryptoProvider } from "../../ports/ICryptoProvider";
import type { IFileRepository } from "../../ports/IFileRepository";
import { DECRYPTION_PENDING_PREFIX } from "./SyncConstants";
import type { IndexedItem } from "./SyncTypes";

interface UpsertDependencies {
  fileRepo: Pick<IFileRepository, "get">;
  cryptoProvider: Pick<ICryptoProvider, "decrypt">;
}

interface UpsertOptions {
  item: GistIndexItem;
  remoteContentRaw: string;
  remoteUpdatedAt: string;
  upsertFiles: NexusFile[];
  conflictFiles: NexusFile[];
}

export class ShardUpsertService {
  constructor(private readonly deps: UpsertDependencies) {}

  createLookupMaps(index: NexusIndex): {
    itemById: Map<string, IndexedItem>;
    itemByStorageKey: Map<string, IndexedItem>;
  } {
    const itemById = new Map<string, IndexedItem>();
    const itemByStorageKey = new Map<string, IndexedItem>();

    for (const category of index.categories) {
      for (const item of category.items) {
        itemById.set(item.id, { categoryId: category.id, item });
        if (!item.storage) {
          continue;
        }
        itemByStorageKey.set(`${item.storage.gistId}::${item.storage.gist_file}`, {
          categoryId: category.id,
          item,
        });
      }
    }

    return { itemById, itemByStorageKey };
  }

  findIndexedItemByLegacyFilename(
    index: NexusIndex,
    filename: string,
  ): IndexedItem | null {
    for (const category of index.categories) {
      const item = category.items.find((candidate) => candidate.gist_file === filename);
      if (item) {
        return { categoryId: category.id, item };
      }
    }
    return null;
  }

  async appendUpsertFile(options: UpsertOptions): Promise<void> {
    const remoteContent = await this.decryptIfNeeded(
      options.item,
      options.remoteContentRaw,
    );
    const remoteChecksum = calculateChecksum(remoteContent);
    const localFile = await this.deps.fileRepo.get(options.item.id);

    if (localFile && localFile.isDirty && localFile.checksum !== remoteChecksum) {
      options.conflictFiles.push(
        new NexusFile(
          `${options.item.id}_conflict_${Date.now().toString(36)}`,
          `${options.item.title} (Conflict)`,
          localFile.content,
          localFile.language,
          localFile.tags,
          localFile.updatedAt,
          true,
          localFile.checksum,
          localFile.lastSyncedAt,
          localFile.isSecure,
        ),
      );
    }

    options.upsertFiles.push(
      new NexusFile(
        options.item.id,
        options.item.title,
        remoteContent,
        options.item.language,
        options.item.tags || [],
        options.remoteUpdatedAt,
        false,
        remoteChecksum,
        options.remoteUpdatedAt,
        !!options.item.isSecure,
      ),
    );
  }

  private async decryptIfNeeded(
    item: GistIndexItem,
    remoteContentRaw: string,
  ): Promise<string> {
    if (!item.isSecure) {
      return remoteContentRaw;
    }

    try {
      return await this.deps.cryptoProvider.decrypt(remoteContentRaw);
    } catch (error) {
      console.error(`Failed to decrypt ${item.gist_file}`, error);
      return `${DECRYPTION_PENDING_PREFIX}${remoteContentRaw}`;
    }
  }
}
