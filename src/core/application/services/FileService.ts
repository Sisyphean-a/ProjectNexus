import type { IFileRepository } from '../ports/IFileRepository';
import { NexusFile } from '../../domain/entities/NexusFile';
import { IdGenerator } from '../../domain/shared/IdGenerator';
import type { SyncService } from './SyncService';
import type { NexusIndex, NexusConfig } from '../../domain/entities/types';

export interface FileContext {
  index: NexusIndex;
  config: NexusConfig;
  lastRemoteUpdatedAt: string | null;
}

export class FileService {
  constructor(
    private fileRepo: IFileRepository,
    private syncService: SyncService
  ) {}

  async createFile(
    ctx: FileContext,
    categoryId: string,
    title: string,
    language: string,
    initialContent: string = ''
  ): Promise<{ file: NexusFile; newRemoteTime?: string }> {
    const cat = ctx.index.categories.find(c => c.id === categoryId);
    if (!cat) throw new Error('Category not found');

    const file = new NexusFile(
      IdGenerator.generate(),
      title,
      initialContent || `# ${title}\n`,
      language,
      [],
      new Date().toISOString(),
      true // dirty initially until synced
    );

    // 1. Save Local
    await this.fileRepo.save(file);

    // 2. Update Index
    cat.items.push({
      id: file.id,
      title: file.title,
      gist_file: file.filename,
      language: file.language,
      tags: []
    });

    // 3. Push to Gist
    let newRemoteTime: string | undefined;
    if (ctx.config.gistId) {
      // Save Index first (to reserve the entry)
      newRemoteTime = await this.syncService.pushIndex(
        ctx.config.gistId, 
        ctx.index, 
        ctx.lastRemoteUpdatedAt
      );
      
      // Save File Content
      await this.syncService.pushFile(ctx.config.gistId, file);
    }

    return { file, newRemoteTime };
  }

  async updateContent(
    ctx: FileContext,
    fileId: string,
    content: string
  ): Promise<void> {
     // Local Update Only (Debounced save usually)
     // But here we might trigger sync if requested? 
     // Usually content update is separated from Sync for performance.
     // But useNexusStore.saveFileContent does Push.
     
     const file = await this.fileRepo.get(fileId);
     if (!file) throw new Error('File not found');

     file.updateContent(content);
     await this.fileRepo.save(file);

     if (ctx.config.gistId) {
         // Async push (Fire and forget, or awaited)
         await this.syncService.pushFile(ctx.config.gistId, file);
     }
  }

  async deleteFile(
      ctx: FileContext,
      categoryId: string,
      fileId: string
  ): Promise<{ newRemoteTime?: string }> {
      const cat = ctx.index.categories.find(c => c.id === categoryId);
      if (!cat) return {};

      const idx = cat.items.findIndex(i => i.id === fileId);
      if (idx === -1) return {};
      
      const item = cat.items[idx];

      // 1. Delete Local
      await this.fileRepo.delete(fileId);
      
      // 2. Update Index
      cat.items.splice(idx, 1);

      let newRemoteTime: string | undefined;
      // 3. Sync
      if (ctx.config.gistId) {
          // Push Index
          newRemoteTime = await this.syncService.pushIndex(
              ctx.config.gistId,
              ctx.index,
              ctx.lastRemoteUpdatedAt
          );
          // Delete Remote File
          await this.syncService.deleteRemoteFile(ctx.config.gistId, item.gist_file);
      }
      
      return { newRemoteTime };
  }

  async updateFileMetadata(
      ctx: FileContext,
      fileId: string,
      updates: { title?: string; tags?: string[] }
  ): Promise<{ newRemoteTime?: string }> {
      const file = await this.fileRepo.get(fileId);
      if (!file) throw new Error('File not found in DB'); // Should not happen if Index has it?
      // Actually index is source of truth for structure, DB for content.
      
      // Update Index Entry
      let item: any;
      for (const cat of ctx.index.categories) {
          item = cat.items.find(i => i.id === fileId);
          if (item) break;
      }
      if (!item) throw new Error('File not found in Index');

      if (updates.title !== undefined) {
          file.title = updates.title;
          item.title = updates.title;
      }
      if (updates.tags !== undefined) {
          file.tags = updates.tags;
          item.tags = updates.tags;
      }

      // Save Local DB (Entity)
      await this.fileRepo.save(file);
      
      let newRemoteTime: string | undefined;
      if (ctx.config.gistId) {
          // Push Index (Metadata lives in Index)
          // Also DB has metadata copies, but Gist only has Index for metadata (except tags inside file? No, tags in index).
          newRemoteTime = await this.syncService.pushIndex(
              ctx.config.gistId,
              ctx.index,
              ctx.lastRemoteUpdatedAt
          );
      }
      return { newRemoteTime };
  }

  async changeLanguage(
      ctx: FileContext,
      fileId: string,
      newLanguage: string
  ): Promise<{ success: boolean; newRemoteTime?: string }> {
      const file = await this.fileRepo.get(fileId);
      if (!file) return { success: false };
      
      const oldFilename = file.filename;
      file.changeLanguage(newLanguage);
      const newFilename = file.filename;
      
      if (oldFilename === newFilename) {
          // Language changed but extension same (e.g. yaml vs yml if mapped same)
          // Just save local and index update
          await this.fileRepo.save(file);
           // Update Index Entry
          for (const cat of ctx.index.categories) {
              const item = cat.items.find(i => i.id === fileId);
              if (item) {
                  item.language = newLanguage;
                  break;
              }
          }
          let newRemoteTime: string | undefined;
          if (ctx.config.gistId) {
             newRemoteTime = await this.syncService.pushIndex(
                 ctx.config.gistId,
                 ctx.index,
                 ctx.lastRemoteUpdatedAt
             );
          }
          return { success: true, newRemoteTime };
      }

      // Update Index Entry
      for (const cat of ctx.index.categories) {
          const item = cat.items.find(i => i.id === fileId);
          if (item) {
              item.language = newLanguage;
              item.gist_file = newFilename;
              break;
          }
      }

      // Save Local DB
      await this.fileRepo.save(file);
      
      let newRemoteTime: string | undefined;
      // Sync
      if (ctx.config.gistId) {
           // Rename triggers delete old + push new
           await this.syncService.deleteRemoteFile(ctx.config.gistId, oldFilename);
           await this.syncService.pushFile(ctx.config.gistId, file);
           
           newRemoteTime = await this.syncService.pushIndex(
               ctx.config.gistId,
               ctx.index,
               ctx.lastRemoteUpdatedAt
           );
      }
      
      return { success: true, newRemoteTime };
  }
}
