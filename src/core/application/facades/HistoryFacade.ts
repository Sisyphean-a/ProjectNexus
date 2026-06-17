import type { GistHistoryEntry } from "../../domain/entities/types";
import type { HistoryEntry } from "../../../infrastructure/db/NexusDatabase";

interface HistoryRepository {
  addSnapshot(
    fileId: string,
    content: string,
    type: HistoryEntry["type"],
    note?: string,
    timestamp?: string,
  ): Promise<number>;
  pruneHistory(fileId: string, keepCount?: number): Promise<void>;
  getHistory(fileId: string, limit?: number): Promise<HistoryEntry[]>;
  deleteFileHistory(fileId: string): Promise<void>;
  clearAll(): Promise<void>;
}

interface HistoryGistGateway {
  getGistHistory(gistId: string): Promise<GistHistoryEntry[]>;
  getGistVersion(
    gistId: string,
    version: string,
  ): Promise<Record<string, { content: string }>>;
}

const HISTORY_IMPORT_LIMIT = 10;

export class HistoryFacade {
  constructor(
    private historyRepository: HistoryRepository,
    private gistRepository: HistoryGistGateway,
  ) {}

  async getFileHistory(fileId: string) {
    return this.historyRepository.getHistory(fileId);
  }

  async recordManualSnapshot(fileId: string, content: string) {
    await this.historyRepository.addSnapshot(fileId, content, "manual");
    await this.historyRepository.pruneHistory(fileId);
  }

  async recordRestoreSnapshot(fileId: string, content: string) {
    await this.historyRepository.addSnapshot(
      fileId,
      content,
      "restore",
      "Restored from history",
    );
  }

  async recordAutoSnapshot(fileId: string, content: string) {
    await this.historyRepository.addSnapshot(fileId, content, "auto", "自动保存");
  }

  async importRemoteHistory(
    rootGistId: string,
    fileId: string,
    filename: string,
  ): Promise<number> {
    const history = await this.gistRepository.getGistHistory(rootGistId);
    const recentHistory = history.slice(0, HISTORY_IMPORT_LIMIT);
    let importedCount = 0;

    for (const entry of recentHistory) {
      const files = await this.gistRepository.getGistVersion(rootGistId, entry.version);
      const targetFile = files[filename];
      if (!targetFile) {
        continue;
      }
      await this.historyRepository.addSnapshot(
        fileId,
        targetFile.content,
        "sync",
        `Imported from Gist (${entry.version.substring(0, 7)})`,
        entry.committedAt,
      );
      importedCount += 1;
    }

    return importedCount;
  }

  async getRemoteHistory(rootGistId: string) {
    return this.gistRepository.getGistHistory(rootGistId);
  }

  async getRemoteVersionContent(
    rootGistId: string,
    version: string,
    filename: string,
  ): Promise<string | null> {
    const files = await this.gistRepository.getGistVersion(rootGistId, version);
    return files[filename]?.content || null;
  }

  async deleteFileHistory(fileId: string) {
    await this.historyRepository.deleteFileHistory(fileId);
  }

  async clearAll() {
    await this.historyRepository.clearAll();
  }
}
