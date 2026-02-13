import type { IFileRepository } from "../ports/IFileRepository";
import { NexusFile } from "../../domain/entities/NexusFile";
import { IdGenerator } from "../../domain/shared/IdGenerator";
import type { SyncService } from "./SyncService";
import type { NexusConfig, NexusIndex, GistIndexItem } from "../../domain/entities/types";

export interface FileContext {
  index: NexusIndex;
  config: NexusConfig;
  lastRemoteUpdatedAt: string | null;
}

export class FileService {
  constructor(
    private fileRepo: IFileRepository,
    private syncService: SyncService,
  ) {}

  async createFile(
    ctx: FileContext,
    categoryId: string,
    title: string,
    language: string,
    initialContent: string = "",
  ): Promise<{ file: NexusFile; newRemoteTime?: string }> {
    const cat = ctx.index.categories.find((c) => c.id === categoryId);
    if (!cat) throw new Error("Category not found");

    const file = new NexusFile(
      IdGenerator.generate(),
      title,
      initialContent || `# ${title}\n`,
      language,
      [],
      new Date().toISOString(),
      true,
    );

    await this.fileRepo.save(file);

    const item: GistIndexItem = {
      id: file.id,
      title: file.title,
      gist_file: file.filename,
      language: file.language,
      tags: [],
    };

    const rootGistId = this.getRootGistId(ctx.config);
    const isV2 = this.isV2Context(ctx);

    if (rootGistId && isV2) {
      await this.syncService.assignStorageForItem(
        rootGistId,
        ctx.index,
        categoryId,
        item,
        file.content,
      );
    }

    cat.items.push(item);

    let newRemoteTime: string | undefined;
    if (rootGistId) {
      newRemoteTime = await this.syncService.pushIndex(
        rootGistId,
        ctx.index,
        ctx.lastRemoteUpdatedAt,
      );

      newRemoteTime = await this.syncService.pushFile(
        rootGistId,
        ctx.index,
        file.id,
        file,
      );
    }

    return { file, newRemoteTime };
  }

  async updateContent(
    ctx: FileContext,
    fileId: string,
    content: string,
  ): Promise<{ newRemoteTime?: string }> {
    const file = await this.fileRepo.get(fileId);
    if (!file) throw new Error("File not found");

    file.updateContent(content);
    await this.fileRepo.save(file);

    const rootGistId = this.getRootGistId(ctx.config);

    let newRemoteTime: string | undefined;
    if (rootGistId) {
      newRemoteTime = await this.syncService.pushFile(
        rootGistId,
        ctx.index,
        fileId,
        file,
      );
    }
    return { newRemoteTime };
  }

  async deleteFile(
    ctx: FileContext,
    categoryId: string,
    fileId: string,
  ): Promise<{ newRemoteTime?: string }> {
    const cat = ctx.index.categories.find((c) => c.id === categoryId);
    if (!cat) return {};

    const idx = cat.items.findIndex((i) => i.id === fileId);
    if (idx === -1) return {};

    const item = cat.items[idx];

    await this.fileRepo.delete(fileId);
    cat.items.splice(idx, 1);

    const rootGistId = this.getRootGistId(ctx.config);

    let newRemoteTime: string | undefined;
    if (rootGistId) {
      const intermediateTime = await this.syncService.deleteRemoteFile(
        rootGistId,
        ctx.index,
        item.id,
        item.gist_file,
        item.storage,
      );
      newRemoteTime = await this.syncService.pushIndex(
        rootGistId,
        ctx.index,
        intermediateTime,
      );
    }

    return { newRemoteTime };
  }

  async updateFileMetadata(
    ctx: FileContext,
    fileId: string,
    updates: { title?: string; tags?: string[] },
  ): Promise<{ newRemoteTime?: string }> {
    const file = await this.fileRepo.get(fileId);
    if (!file) throw new Error("File not found in DB");

    let item: GistIndexItem | undefined;
    for (const cat of ctx.index.categories) {
      item = cat.items.find((i) => i.id === fileId);
      if (item) break;
    }
    if (!item) throw new Error("File not found in Index");

    if (updates.title !== undefined) {
      file.title = updates.title;
      item.title = updates.title;
    }
    if (updates.tags !== undefined) {
      file.tags = updates.tags;
      item.tags = updates.tags;
    }

    await this.fileRepo.save(file);

    const rootGistId = this.getRootGistId(ctx.config);

    let newRemoteTime: string | undefined;
    if (rootGistId) {
      newRemoteTime = await this.syncService.pushIndex(
        rootGistId,
        ctx.index,
        ctx.lastRemoteUpdatedAt,
      );
    }
    return { newRemoteTime };
  }

  async changeLanguage(
    ctx: FileContext,
    fileId: string,
    newLanguage: string,
  ): Promise<{ success: boolean; newRemoteTime?: string }> {
    const file = await this.fileRepo.get(fileId);
    if (!file) return { success: false };

    const oldFilename = file.filename;
    file.changeLanguage(newLanguage);
    const newFilename = file.filename;

    for (const cat of ctx.index.categories) {
      const item = cat.items.find((i) => i.id === fileId);
      if (item) {
        item.language = newLanguage;
        item.gist_file = newFilename;
        if (item.storage) {
          item.storage.gist_file = newFilename;
        }
        break;
      }
    }

    await this.fileRepo.save(file);

    const rootGistId = this.getRootGistId(ctx.config);

    if (!rootGistId) {
      return { success: true };
    }

    if (oldFilename === newFilename) {
      const newRemoteTime = await this.syncService.pushIndex(
        rootGistId,
        ctx.index,
        ctx.lastRemoteUpdatedAt,
      );
      return { success: true, newRemoteTime };
    }

    let intermediateTime = await this.syncService.deleteRemoteFile(
      rootGistId,
      ctx.index,
      fileId,
      oldFilename,
    );

    intermediateTime = await this.syncService.pushFile(
      rootGistId,
      ctx.index,
      fileId,
      file,
    );

    const newRemoteTime = await this.syncService.pushIndex(
      rootGistId,
      ctx.index,
      intermediateTime,
    );

    return { success: true, newRemoteTime };
  }

  private getRootGistId(config: NexusConfig): string | null {
    return config.rootGistId || config.gistId || null;
  }

  private isV2Context(ctx: FileContext): boolean {
    return (ctx.index.version || ctx.config.schemaVersion || 1) >= 2;
  }
}
