import type { ICryptoProvider } from "../../ports/ICryptoProvider";
import type { IFileRepository } from "../../ports/IFileRepository";
import type { IGistRepository } from "../../ports/IGistRepository";
import type {
  GistIndexItem,
  NexusFileStorage,
  NexusIndex,
} from "../../../domain/entities/types";
import { NexusFile } from "../../../domain/entities/NexusFile";
import { ShardManifestService } from "../ShardManifestService";
import { ShardStateService } from "./ShardStateService";

interface PushFileOptions {
  rootGistId: string;
  index: NexusIndex;
  fileId: string;
  file: NexusFile;
}

interface DeleteFileOptions {
  rootGistId: string;
  index: NexusIndex;
  fileId: string;
  filename: string;
  storageOverride?: NexusFileStorage;
}

interface RemoteFileSyncDependencies {
  gistRepo: Pick<IGistRepository, "updateGistFile">;
  fileRepo: Pick<IFileRepository, "save">;
  cryptoProvider: Pick<ICryptoProvider, "encrypt" | "hasPassword">;
  shardManifestService: Pick<
    ShardManifestService,
    "removeByItem" | "removeByStorage" | "upsert"
  >;
  shardStateService: Pick<ShardStateService, "updateRootShardState">;
}

export class RemoteFileSyncService {
  constructor(private readonly deps: RemoteFileSyncDependencies) {}

  async pushFile(options: PushFileOptions): Promise<string> {
    if ((options.index.version || 1) < 2) {
      return this.pushLegacyFile(options.rootGistId, options.file);
    }

    const indexedItem = this.findItemById(options.index, options.fileId);
    if (!indexedItem) {
      throw new Error("Index item not found for file");
    }
    if (!indexedItem.storage) {
      throw new Error("V2 index item is missing storage mapping");
    }

    indexedItem.gist_file = options.file.filename;
    indexedItem.storage.gist_file = options.file.filename;

    const contentToPush = await this.resolveContentToPush(options.file);
    const contentTime = await this.deps.gistRepo.updateGistFile(
      indexedItem.storage.gistId,
      indexedItem.storage.gist_file,
      contentToPush,
    );
    const updatedManifest = await this.deps.shardManifestService.upsert(
      options.index,
      indexedItem,
      options.file,
      contentTime,
    );
    const rootTime = await this.deps.shardStateService.updateRootShardState(
      options.rootGistId,
      options.index,
      indexedItem.storage.gistId,
      updatedManifest,
    );

    options.file.markClean();
    await this.deps.fileRepo.save(options.file);
    return rootTime || contentTime;
  }

  async deleteRemoteFile(options: DeleteFileOptions): Promise<string> {
    if ((options.index.version || 1) < 2) {
      return this.deps.gistRepo.updateGistFile(
        options.rootGistId,
        options.filename,
        null,
      );
    }

    if (options.storageOverride) {
      return this.deleteFileByStorage(options, options.storageOverride);
    }

    const indexedItem = this.findItemById(options.index, options.fileId);
    if (!indexedItem?.storage) {
      return this.deps.gistRepo.updateGistFile(
        options.rootGistId,
        options.filename,
        null,
      );
    }

    const deletionTime = await this.deps.gistRepo.updateGistFile(
      indexedItem.storage.gistId,
      indexedItem.storage.gist_file,
      null,
    );
    const manifest = await this.deps.shardManifestService.removeByItem(
      options.index,
      indexedItem,
    );
    const rootTime = await this.deps.shardStateService.updateRootShardState(
      options.rootGistId,
      options.index,
      indexedItem.storage.gistId,
      manifest,
    );
    return rootTime || deletionTime;
  }

  private async pushLegacyFile(
    gistId: string,
    file: NexusFile,
  ): Promise<string> {
    const contentToPush = await this.resolveContentToPush(file);
    const newTime = await this.deps.gistRepo.updateGistFile(
      gistId,
      file.filename,
      contentToPush,
    );

    file.markClean();
    await this.deps.fileRepo.save(file);
    return newTime;
  }

  private async resolveContentToPush(file: NexusFile): Promise<string> {
    if (!file.isSecure) {
      return file.content;
    }
    if (!this.deps.cryptoProvider.hasPassword()) {
      throw new Error("Vault password not set. Cannot push secure file.");
    }
    return this.deps.cryptoProvider.encrypt(file.content);
  }

  private async deleteFileByStorage(
    options: DeleteFileOptions,
    storage: NexusFileStorage,
  ): Promise<string> {
    const deletionTime = await this.deps.gistRepo.updateGistFile(
      storage.gistId,
      options.filename,
      null,
    );
    const manifest = await this.deps.shardManifestService.removeByStorage(
      options.index,
      options.fileId,
      storage,
    );
    const rootTime = await this.deps.shardStateService.updateRootShardState(
      options.rootGistId,
      options.index,
      storage.gistId,
      manifest,
    );
    return rootTime || deletionTime;
  }

  private findItemById(index: NexusIndex, fileId: string): GistIndexItem | null {
    for (const category of index.categories) {
      const item = category.items.find((candidate) => candidate.id === fileId);
      if (item) {
        return item;
      }
    }
    return null;
  }
}
