import type { IGistRepository } from '../ports/IGistRepository';
import type { ILocalStore } from '../ports/ILocalStore';
import type { IFileRepository } from '../ports/IFileRepository';
import type { NexusConfig, NexusIndex, GistIndexItem } from '../../domain/entities/types';
import { NexusFile } from '../../domain/entities/NexusFile';

export class SyncService {
  constructor(
    private gistRepo: IGistRepository,
    private localStore: ILocalStore,
    private fileRepo: IFileRepository
  ) {}

  async initializeNexus(initialIndex: NexusIndex): Promise<string> {
      const gistId = await this.gistRepo.createNexusGist(initialIndex);
      await this.localStore.saveIndex(initialIndex);
      return gistId;
  }

  /**
   * 执行入站同步 (Pull from Remote)
   * 策略: Smart Sync (检查 update_at -> 全量拉取)
   */
  async syncDown(config: NexusConfig, lastRemoteUpdatedAt: string | null): Promise<{
    index: NexusIndex | null;
    synced: boolean;
    configUpdates?: Partial<NexusConfig>; // 比如发现了 Gist ID
  }> {
    
    let gistId = config.gistId;

    // 1. Auto-discovery if missing
    if (!gistId) {
      gistId = await this.gistRepo.findNexusGist();
      if (!gistId) {
        throw new Error('未找到 Nexus Gist，请先初始化');
      }
    }

    // 2. Metadata Check (Incremental)
    // 注意：fetchGist 返回的是 Gist 元数据对象，包含 updated_at
    const gistMeta = await this.gistRepo.fetchGist(gistId);
    const remoteTime = gistMeta.updated_at;

    // 如果本地记录的远程时间与当前远程一致，且本地有索引，则跳过
    if (lastRemoteUpdatedAt === remoteTime) {
      return { index: null, synced: false };
    }

    console.log('[SyncService] 拉取远程更新...', remoteTime);

    // 3. Full Content Fetch
    const files = await this.gistRepo.getGistContent(gistId);
    const indexFile = files['nexus_index.json'];
    
    if (!indexFile) {
        throw new Error('Gist 中缺少 nexus_index.json');
    }

    const remoteIndex = JSON.parse(indexFile.content) as NexusIndex;

    // 4. Transform & Save Files
    const nexusFiles: NexusFile[] = [];
    
    // 构建映射: Gist Filename -> Index Item Info
    const fileMap = new Map<string, GistIndexItem>();
    remoteIndex.categories.forEach(cat => {
        cat.items.forEach(item => {
            fileMap.set(item.gist_file, item);
        });
    });

    for (const [filename, gistFile] of Object.entries(files)) {
        if (filename === 'nexus_index.json' || filename === 'README.md') continue;
        
        const itemInfo = fileMap.get(filename);
        if (itemInfo) {
            const nexusFile = new NexusFile(
                itemInfo.id,
                itemInfo.title,
                gistFile.content,
                itemInfo.language, // 优先使用索引中的语言定义
                itemInfo.tags || [],
                gistFile.updated_at || new Date().toISOString(),
                false // clean
            );
            nexusFiles.push(nexusFile);
        }
    }

    // Bulk Save to DB
    if (nexusFiles.length > 0) {
        await this.fileRepo.saveBulk(nexusFiles);
    }
    
    // Save Index to Local
    await this.localStore.saveIndex(remoteIndex);

    return {
        index: remoteIndex,
        synced: true,
        configUpdates: config.gistId !== gistId ? { gistId } : undefined
    };
  }

  /**
   * 推送索引更新 (Check Conflict -> Push)
   */
  async pushIndex(
      gistId: string, 
      index: NexusIndex, 
      lastKnownRemoteTime: string | null,
      force = false
  ): Promise<string> {
      // 1. Conflict Check
      if (!force) {
          try {
              // Fetch ONLY metadata first if optimized Gist adapter allows, 
              // currently GistRepo fetchGist gets meta.
              const meta = await this.gistRepo.fetchGist(gistId);
              const remoteTime = new Date(meta.updated_at).getTime();
              const localTime = lastKnownRemoteTime ? new Date(lastKnownRemoteTime).getTime() : 0;
              
              if (remoteTime > localTime) {
                  throw new Error('检测到同步冲突！远程数据已被其他设备更新。');
              }
          } catch (e: any) {
             // If manual "Force", we skip this.
             if (e.message.includes('同步冲突')) throw e;
             console.warn('Conflict check failed, proceeding cautiously', e);
          }
      }

      // 2. Push
      index.updated_at = new Date().toISOString();
      await this.gistRepo.updateGistFile(gistId, 'nexus_index.json', JSON.stringify(index, null, 2));
      
      // 3. Save Local
      await this.localStore.saveIndex(index);
      
      return index.updated_at;
  }

  async pushFile(gistId: string, file: NexusFile): Promise<void> {
      await this.gistRepo.updateGistFile(gistId, file.filename, file.content);
      // Mark clean locally
      file.markClean();
      await this.fileRepo.save(file);
  }

  async deleteRemoteFile(gistId: string, filename: string): Promise<void> {
      await this.gistRepo.updateGistFile(gistId, filename, null);
  }
}
