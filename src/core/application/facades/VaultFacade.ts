import type { NexusConfig, NexusIndex } from "../../domain/entities/types";
import type { IFileRepository } from "../ports/IFileRepository";
import type { ICryptoProvider, SetPasswordOptions } from "../ports/ICryptoProvider";
import { DECRYPTION_PENDING_PREFIX, type SyncService } from "../services/SyncService";

export interface VaultContext {
  config: NexusConfig;
  index: NexusIndex;
  lastRemoteUpdatedAt: string | null;
}

export class VaultFacade {
  constructor(
    private cryptoProvider: ICryptoProvider,
    private fileRepository: IFileRepository,
    private syncService: SyncService,
  ) {}

  hasPassword(): boolean {
    return this.cryptoProvider.hasPassword();
  }

  async setPassword(password: string, options: SetPasswordOptions = {}): Promise<void> {
    await this.cryptoProvider.setPassword(password, options);
  }

  async getFileContent(fileId: string): Promise<string> {
    const file = await this.fileRepository.get(fileId);
    if (!file) {
      return "";
    }

    if (!file.isSecure || this.cryptoProvider.hasPassword()) {
      return file.content;
    }

    if (!file.isDirty) {
      try {
        await this.fileRepository.delete(file.id);
      } catch {
        // no-op
      }
    }

    return DECRYPTION_PENDING_PREFIX;
  }

  async resetSecureCache(index: NexusIndex | null): Promise<void> {
    if (!index) {
      return;
    }

    const secureFileIds = index.categories.flatMap((category) =>
      category.items.filter((item) => item.isSecure).map((item) => item.id),
    );

    await Promise.all(
      secureFileIds.map(async (fileId) => {
        const file = await this.fileRepository.get(fileId);
        if (file && !file.isDirty) {
          await this.fileRepository.delete(fileId);
        }
      }),
    );
  }

  async updateFileSecureStatus(
    ctx: VaultContext,
    fileId: string,
    isSecure: boolean,
  ): Promise<{ newRemoteTime?: string }> {
    let itemFound = false;
    for (const category of ctx.index.categories) {
      const item = category.items.find((entry) => entry.id === fileId);
      if (!item) {
        continue;
      }
      item.isSecure = isSecure;
      itemFound = true;
      break;
    }

    if (!itemFound) {
      return {};
    }

    const file = await this.fileRepository.get(fileId);
    if (!file) {
      return {};
    }

    file.isSecure = isSecure;
    await this.fileRepository.save(file);

    const gistId = ctx.config.rootGistId || ctx.config.gistId;
    if (!gistId) {
      return {};
    }

    const intermediateTime = await this.syncService.pushIndex(
      gistId,
      ctx.index,
      ctx.lastRemoteUpdatedAt,
    );
    const newRemoteTime = await this.syncService.pushFile(
      gistId,
      ctx.index,
      fileId,
      file,
    );

    return { newRemoteTime: newRemoteTime || intermediateTime };
  }
}
