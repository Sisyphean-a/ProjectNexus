import { nexusDb, type HistoryEntry } from "../db/NexusDatabase";

export class LocalHistoryRepository {
  /**
   * 添加历史快照
   * @param fileId 文件 ID
   * @param content 文件内容
   * @param type 快照类型
   * @param note 备注
   */
  async addSnapshot(
    fileId: string,
    content: string,
    type: HistoryEntry["type"] = "manual",
    note?: string,
    timestamp?: string, // Optional custom timestamp
  ): Promise<number> {
    // 简单的去重逻辑：如果最新一条记录内容相同，则不添加
    // 注意：如果是导入历史（指定了 timestamp），则跳过去重检查，或者需要更复杂的检查
    // 为简单起见，如果提供了 timestamp (import 模式)，我们假设调用者知道自己在做什么，或者只做基础去重
    if (!timestamp) {
        const lastEntry = await this.getLatestSnapshot(fileId);
        if (lastEntry && lastEntry.content === content) {
          return lastEntry.id!;
        }
    }

    return await nexusDb.history.add({
      fileId,
      content,
      timestamp: timestamp || new Date().toISOString(),
      type,
      note,
    });
  }

  /**
   * 获取文件的历史记录（按时间倒序）
   * @param fileId 文件 ID
   * @param limit 限制数量
   */
  async getHistory(fileId: string, limit = 50): Promise<HistoryEntry[]> {
    const items = await nexusDb.history
      .where("fileId")
      .equals(fileId)
      .toArray();
    
    // In-memory sort by timestamp descending (Newest first)
    return items
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
  }

  /**
   * 获取最新快照
   */
  async getLatestSnapshot(fileId: string): Promise<HistoryEntry | undefined> {
    return await nexusDb.history
      .where("fileId")
      .equals(fileId)
      .reverse()
      .first();
  }

  /**
   * 获取特定快照
   * @param id 历史记录 ID
   */
  async getSnapshot(id: number): Promise<HistoryEntry | undefined> {
    return await nexusDb.history.get(id);
  }

  /**
   * 清理过期的历史记录（保留最近 N 条）
   * @param fileId 文件 ID
   * @param keepCount 保留条数
   */
  async pruneHistory(fileId: string, keepCount = 100): Promise<void> {
    const count = await nexusDb.history.where("fileId").equals(fileId).count();
    if (count <= keepCount) return;

    // 获取需要删除的 keys
    const keysToDelete = await nexusDb.history
      .where("fileId")
      .equals(fileId)
      .reverse()
      .offset(keepCount)
      .keys();

    await nexusDb.history.bulkDelete(keysToDelete as number[]);
  }
  
  /**
   * 删除文件所有历史
   */
   async deleteFileHistory(fileId: string): Promise<void> {
       await nexusDb.history.where("fileId").equals(fileId).delete();
   }
}

export const localHistoryRepository = new LocalHistoryRepository();
