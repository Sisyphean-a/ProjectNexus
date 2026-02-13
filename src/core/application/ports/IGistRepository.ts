import type {
  GistFile,
  GistHistoryEntry,
  NexusIndex,
  ShardDescriptor,
  ShardManifest,
} from "../../domain/entities/types";

export interface IGistRepository {
  verifyToken(token: string): Promise<boolean>;
  fetchGist(gistId: string): Promise<any>;
  findNexusGist(): Promise<string | null>; // Returns gist ID if found
  createNexusGist(initialIndex: NexusIndex): Promise<string>; // Returns new gist ID
  createShardGist(
    shardId: string,
    categoryName: string,
    part: number,
    categoryId?: string,
    kind?: "category" | "large",
  ): Promise<string>;
  updateGistFile(
    gistId: string,
    filename: string,
    content: string | null,
  ): Promise<string>; // Returns updated_at

  getGistContent(gistId: string): Promise<Record<string, GistFile>>;
  getGistFilesByNames(
    gistId: string,
    filenames: string[],
  ): Promise<Record<string, GistFile>>;

  // 版本历史方法
  getGistHistory(gistId: string): Promise<GistHistoryEntry[]>;

  updateBatch(
    gistId: string,
    files: Record<string, string | null>,
  ): Promise<string>;
  updateGistDescription(gistId: string, description: string): Promise<void>;
  deleteGist(gistId: string): Promise<void>;
  getGistVersion(
    gistId: string,
    sha: string,
  ): Promise<Record<string, GistFile>>;
  listNexusShards(rootGistId: string): Promise<ShardDescriptor[]>;
  listAllShardGistIds(): Promise<string[]>;
  fetchShardManifest(gistId: string): Promise<ShardManifest | null>;
  updateShardManifest(gistId: string, manifest: ShardManifest): Promise<string>;
}
