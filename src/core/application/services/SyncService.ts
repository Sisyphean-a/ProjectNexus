import type { IGistRepository } from "../ports/IGistRepository";
import type { ILocalStore } from "../ports/ILocalStore";
import type { IFileRepository } from "../ports/IFileRepository";
import type {
  NexusConfig,
  NexusIndex,
  GistIndexItem,
} from "../../domain/entities/types";
import { NexusFile } from "../../domain/entities/NexusFile";
import { calculateChecksum } from "../../domain/shared/Hash";

export class SyncService {
  constructor(
    private gistRepo: IGistRepository,
    private localStore: ILocalStore,
    private fileRepo: IFileRepository,
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
  async syncDown(
    config: NexusConfig,
    lastRemoteUpdatedAt: string | null,
  ): Promise<{
    index: NexusIndex | null;
    synced: boolean;
    gistUpdatedAt?: string;
    configUpdates?: Partial<NexusConfig>; // 比如发现了 Gist ID
  }> {
    let gistId = config.gistId;

    // 1. Auto-discovery if missing
    if (!gistId) {
      gistId = await this.gistRepo.findNexusGist();
      if (!gistId) {
        throw new Error("未找到 Nexus Gist，请先初始化");
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

    console.log("[SyncService] 拉取远程更新...", remoteTime);

    // 3. Full Content Fetch
    const files = await this.gistRepo.getGistContent(gistId);
    const indexFile = files["nexus_index.json"];

    if (!indexFile) {
      throw new Error("Gist 中缺少 nexus_index.json");
    }

    const remoteIndex = JSON.parse(indexFile.content) as NexusIndex;

    // 4. Transform & Save Files
    const nexusFiles: NexusFile[] = [];
    const conflictFiles: NexusFile[] = [];

    // 构建映射: Gist Filename -> Index Item Info
    const fileMap = new Map<string, GistIndexItem>();
    remoteIndex.categories.forEach((cat) => {
      cat.items.forEach((item) => {
        fileMap.set(item.gist_file, item);
      });
    });

    for (const [filename, gistFile] of Object.entries(files)) {
      if (filename === "nexus_index.json" || filename === "README.md") continue;

      const itemInfo = fileMap.get(filename);
      if (itemInfo) {
        // --- 冲突检测开始 ---
        const localFile = await this.fileRepo.get(itemInfo.id);
        const remoteContent = gistFile.content;
        const remoteTime = gistFile.updated_at || new Date().toISOString();
        const remoteChecksum = calculateChecksum(remoteContent);

        let nexusFile: NexusFile;

        if (localFile && localFile.isDirty && localFile.checksum !== remoteChecksum) {
          // 发生冲突: 本地已修改且内容与远程不同
          console.warn(`[SyncService] 发现冲突: ${itemInfo.title} (${filename})`);
          
          // 创建冲突副本
          const conflictId = `${itemInfo.id}_conflict_${Date.now().toString(36)}`;
          const conflictFile = new NexusFile(
            conflictId,
            `${itemInfo.title} (Conflict)`,
            localFile.content,
            localFile.language,
            localFile.tags,
            localFile.updatedAt,
            true, // 冲突文件本身也是 dirty 的，需要用户处理
            localFile.checksum,
            localFile.lastSyncedAt
          );
          conflictFiles.push(conflictFile);

          // 保持 ID 不变，但更新为远程内容
          nexusFile = new NexusFile(
            itemInfo.id,
            itemInfo.title,
            remoteContent,
            itemInfo.language,
            itemInfo.tags || [],
            remoteTime,
            false,
            remoteChecksum,
            remoteTime
          );
        } else {
          // 无冲突或本地无修改，直接更新/覆盖
          nexusFile = new NexusFile(
            itemInfo.id,
            itemInfo.title,
            remoteContent,
            itemInfo.language,
            itemInfo.tags || [],
            remoteTime,
            false,
            remoteChecksum,
            remoteTime
          );
        }
        nexusFiles.push(nexusFile);
      }
    }

    // Bulk Save to DB
    if (nexusFiles.length > 0) {
      await this.fileRepo.saveBulk([...nexusFiles, ...conflictFiles]);
    }

    // Save Index to Local
    await this.localStore.saveIndex(remoteIndex);

    return {
      index: remoteIndex,
      synced: true,
      gistUpdatedAt: remoteTime,
      configUpdates: config.gistId !== gistId ? { gistId } : undefined,
    };
  }

  /**
   * 推送索引更新 (Check Conflict -> Push)
   */
  async pushIndex(
    gistId: string,
    index: NexusIndex,
    lastKnownRemoteTime: string | null,
    force = false,
  ): Promise<string> {
    // 1. Conflict Check
    if (!force) {
      try {
        // Fetch ONLY metadata first if optimized Gist adapter allows,
        // currently GistRepo fetchGist gets meta.
        const meta = await this.gistRepo.fetchGist(gistId);
        const remoteTime = new Date(meta.updated_at).getTime();
        const localTime = lastKnownRemoteTime
          ? new Date(lastKnownRemoteTime).getTime()
          : 0;

        if (remoteTime > localTime) {
          throw new Error("检测到同步冲突！远程数据已被其他设备更新。");
        }
      } catch (e: any) {
        // If manual "Force", we skip this.
        if (e.message.includes("同步冲突")) throw e;
        console.warn("Conflict check failed, proceeding cautiously", e);
      }
    }

    // 2. Push
    index.updated_at = new Date().toISOString();
    const gistTime = await this.gistRepo.updateGistFile(
      gistId,
      "nexus_index.json",
      JSON.stringify(index, null, 2),
    );

    // 3. Save Local
    await this.localStore.saveIndex(index);

    return gistTime;
  }

  async pushFile(gistId: string, file: NexusFile): Promise<string> {
    const newTime = await this.gistRepo.updateGistFile(
      gistId,
      file.filename,
      file.content,
    );
    // Mark clean locally
    file.markClean();
    await this.fileRepo.save(file);
    return newTime;
  }

  async deleteRemoteFile(gistId: string, filename: string): Promise<string> {
    return this.gistRepo.updateGistFile(gistId, filename, null);
  }
}
