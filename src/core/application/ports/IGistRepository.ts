import type { GistFile, GistHistoryEntry, NexusIndex } from '../../domain/entities/types';

export interface IGistRepository {
  verifyToken(token: string): Promise<boolean>;
  fetchGist(gistId: string): Promise<any>;
  findNexusGist(): Promise<string | null>; // Returns gist ID if found
  createNexusGist(initialIndex: NexusIndex): Promise<string>; // Returns new gist ID
  updateGistFile(
    gistId: string,
    filename: string,
    content: string | null,
  ): Promise<void>; // null content for delete
  getGistContent(gistId: string): Promise<Record<string, GistFile>>;
  // 版本历史方法
  getGistHistory(gistId: string): Promise<GistHistoryEntry[]>;
  updateBatch(gistId: string, files: Record<string, string | null>): Promise<void>;
  getGistVersion(
    gistId: string,
    sha: string,
  ): Promise<Record<string, GistFile>>;
}
