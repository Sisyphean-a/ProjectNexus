import type {
  GistIndexCategory,
  NexusConfig,
  NexusIndex,
} from "../../domain/entities/types";
import { IdGenerator } from "../../domain/shared/IdGenerator";
import type { FileContext, FileService } from "../services/FileService";
import type { SyncService } from "../services/SyncService";

interface WorkspaceLocalStore {
  getConfig(): Promise<NexusConfig>;
  getIndex(): Promise<NexusIndex | null>;
  saveConfig(config: Partial<NexusConfig>): Promise<void>;
}

interface WorkspaceFileRepo {
  get(id: string): Promise<{ language: string } | null>;
  delete(id: string): Promise<void>;
}

interface WorkspaceHistoryRepo {
  deleteFileHistory(fileId: string): Promise<void>;
}

export interface WorkspaceContext extends FileContext {}

export interface DeleteCategoryResult {
  deletedFiles: number;
  failedFiles: string[];
  newRemoteTime?: string;
}

interface WorkspaceInitResult {
  config: NexusConfig;
  index: NexusIndex | null;
  shouldResetSecureCache: boolean;
}

export class WorkspaceFacade {
  constructor(
    private localStore: WorkspaceLocalStore,
    private fileRepo: WorkspaceFileRepo,
    private historyRepo: WorkspaceHistoryRepo,
    private syncService: SyncService,
    private fileService: FileService,
  ) {}

  async initWorkspace(): Promise<WorkspaceInitResult> {
    const config = await this.localStore.getConfig();
    const localIndex = await this.localStore.getIndex();
    const index = localIndex && Array.isArray(localIndex.categories) ? localIndex : null;
    return {
      config,
      index,
      shouldResetSecureCache: false,
    };
  }

  async updateConfig(
    context: { config: NexusConfig | null },
    updates: Partial<NexusConfig>,
  ): Promise<NexusConfig> {
    await this.localStore.saveConfig(updates);
    return { ...(context.config ?? (await this.localStore.getConfig())), ...updates };
  }

  async initializeGist(): Promise<{ config: NexusConfig; index: NexusIndex }> {
    const config = await this.localStore.getConfig();
    const index: NexusIndex = {
      version: 2,
      updated_at: new Date().toISOString(),
      categories: [
        {
          id: "default",
          name: "General",
          icon: "folder",
          defaultLanguage: "yaml",
          items: [],
        },
      ],
      shards: [],
    };
    const gistId = await this.syncService.initializeNexus(index);
    const nextConfig = {
      ...config,
      gistId,
      rootGistId: gistId,
      schemaVersion: 2,
    };
    await this.localStore.saveConfig({
      gistId,
      rootGistId: gistId,
      schemaVersion: 2,
    });
    return { config: nextConfig, index };
  }

  async addCategory(
    ctx: WorkspaceContext,
    name: string,
    icon = "folder",
    defaultLanguage = "yaml",
  ): Promise<{ category: GistIndexCategory; newRemoteTime?: string }> {
    const category: GistIndexCategory = {
      id: IdGenerator.generate(),
      name,
      icon,
      defaultLanguage,
      items: [],
    };
    ctx.index.categories.push(category);

    try {
      const newRemoteTime = await this.saveIndex(ctx);
      return { category, newRemoteTime };
    } catch (error) {
      ctx.index.categories = ctx.index.categories.filter((item) => item.id !== category.id);
      throw error;
    }
  }

  async updateCategory(
    ctx: WorkspaceContext,
    id: string,
    updates: { name?: string; icon?: string; defaultLanguage?: string },
  ): Promise<{ newRemoteTime?: string }> {
    const category = ctx.index.categories.find((item) => item.id === id);
    if (!category) {
      return {};
    }
    if (updates.name !== undefined) category.name = updates.name;
    if (updates.icon !== undefined) category.icon = updates.icon;
    if (updates.defaultLanguage !== undefined) {
      category.defaultLanguage = updates.defaultLanguage;
    }
    return { newRemoteTime: await this.saveIndex(ctx) };
  }

  async deleteCategory(ctx: WorkspaceContext, id: string): Promise<DeleteCategoryResult> {
    const currentGistId = this.getCurrentGistId(ctx.config);
    if (!currentGistId) {
      return { deletedFiles: 0, failedFiles: [] };
    }

    const categoryIndex = ctx.index.categories.findIndex((item) => item.id === id);
    if (categoryIndex === -1) {
      return { deletedFiles: 0, failedFiles: [] };
    }

    const category = ctx.index.categories[categoryIndex];
    ctx.index.categories.splice(categoryIndex, 1);
    await this.saveIndex(ctx, ctx.index.categories.length === 0);

    const cleanupResults = await Promise.allSettled(
      category.items.map(async (item) => {
        await this.fileRepo.delete(item.id);
        try {
          await this.historyRepo.deleteFileHistory(item.id);
        } catch {
          // no-op
        }
        await this.syncService.deleteRemoteFile(
          currentGistId,
          ctx.index,
          item.id,
          item.gist_file,
          item.storage,
        );
      }),
    );

    const failedFiles = cleanupResults.flatMap((result, index) =>
      result.status === "rejected" ? [category.items[index].gist_file] : [],
    );
    const deletedFiles = cleanupResults.filter((result) => result.status === "fulfilled").length;
    const newRemoteTime = await this.saveIndex(ctx, true);

    return {
      deletedFiles,
      failedFiles,
      newRemoteTime,
    };
  }

  async addFile(
    ctx: WorkspaceContext,
    categoryId: string,
    title: string,
    language?: string,
    initialContent = "",
  ) {
    return this.fileService.createFile(ctx, categoryId, title, language || "yaml", initialContent);
  }

  async saveFileContent(
    ctx: WorkspaceContext,
    fileId: string,
    content: string,
  ): Promise<{ newRemoteTime?: string }> {
    return this.fileService.updateContent(ctx, fileId, content);
  }

  async updateFile(
    ctx: WorkspaceContext,
    fileId: string,
    updates: { title?: string; tags?: string[] },
  ): Promise<{ newRemoteTime?: string }> {
    return this.fileService.updateFileMetadata(ctx, fileId, updates);
  }

  async deleteFile(
    ctx: WorkspaceContext,
    categoryId: string,
    fileId: string,
  ): Promise<{ newRemoteTime?: string }> {
    const result = await this.fileService.deleteFile(ctx, categoryId, fileId);
    try {
      await this.historyRepo.deleteFileHistory(fileId);
    } catch {
      // no-op
    }
    return result;
  }

  async changeFileLanguage(
    ctx: WorkspaceContext,
    fileId: string,
    newLanguage: string,
  ): Promise<{ success: boolean; newRemoteTime?: string }> {
    return this.fileService.changeLanguage(ctx, fileId, newLanguage);
  }

  async getFileLanguage(fileId: string): Promise<string> {
    const file = await this.fileRepo.get(fileId);
    return file?.language || "yaml";
  }

  private getCurrentGistId(config: NexusConfig): string | null {
    return config.rootGistId || config.gistId || null;
  }

  private async saveIndex(
    ctx: WorkspaceContext,
    forceOverwrite = false,
  ): Promise<string | undefined> {
    const currentGistId = this.getCurrentGistId(ctx.config);
    if (!currentGistId) {
      return undefined;
    }
    return this.syncService.pushIndex(
      currentGistId,
      ctx.index,
      ctx.lastRemoteUpdatedAt,
      forceOverwrite,
    );
  }
}
