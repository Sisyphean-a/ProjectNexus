import { nexusDb, type HistoryEntry } from "../db/NexusDatabase";

export class LocalHistoryRepository {
  async addSnapshot(
    fileId: string,
    content: string,
    type: HistoryEntry["type"] = "manual",
    note?: string,
    timestamp?: string,
  ): Promise<number> {
    if (timestamp) {
      const existing = await nexusDb.history
        .where(["fileId", "timestamp"])
        .equals([fileId, timestamp])
        .first();
      if (existing) {
        return existing.id!;
      }
    } else {
      const lastEntry = await this.getLatestSnapshot(fileId);
      if (lastEntry && lastEntry.content === content) {
        return lastEntry.id!;
      }
    }

    return nexusDb.history.add({
      fileId,
      content,
      timestamp: timestamp || new Date().toISOString(),
      type,
      note,
    });
  }

  async getHistory(fileId: string, limit = 50): Promise<HistoryEntry[]> {
    const items = await nexusDb.history.where("fileId").equals(fileId).toArray();
    return items
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, limit);
  }

  async getLatestSnapshot(fileId: string): Promise<HistoryEntry | undefined> {
    return nexusDb.history.where("fileId").equals(fileId).reverse().first();
  }

  async getSnapshot(id: number): Promise<HistoryEntry | undefined> {
    return nexusDb.history.get(id);
  }

  async pruneHistory(fileId: string, keepCount = 100): Promise<void> {
    const count = await nexusDb.history.where("fileId").equals(fileId).count();
    if (count <= keepCount) return;

    const keysToDelete = await nexusDb.history
      .where("fileId")
      .equals(fileId)
      .reverse()
      .offset(keepCount)
      .keys();

    await nexusDb.history.bulkDelete(keysToDelete as number[]);
  }

  async deleteFileHistory(fileId: string): Promise<void> {
    await nexusDb.history.where("fileId").equals(fileId).delete();
  }

  async clearAll(): Promise<void> {
    await nexusDb.history.clear();
  }
}
