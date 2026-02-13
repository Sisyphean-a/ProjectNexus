// 核心实体接口定义
// 此处暂时保持为 TS Interface，后续阶段将升级为充血模型类

export interface GistFile {
  id: string; // Unique ID (often filename or generated)
  filename: string;
  content: string;
  language?: string;
  updated_at?: string;
  tags?: string[];
  description?: string;
}

// 版本历史条目
export interface GistHistoryEntry {
  version: string; // SHA
  committedAt: string;
  changeStatus: {
    additions: number;
    deletions: number;
    total: number;
  };
}

export interface GistIndexItem {
  id: string;
  title: string;
  gist_file: string; // Filename in the Gist
  language: string;  // 语言类型（决定扩展名和语法高亮）
  tags?: string[];
  isSecure?: boolean;
  storage?: NexusFileStorage;
}

export interface GistIndexCategory {
  id: string;
  name: string;
  icon?: string;
  defaultLanguage?: string; // 分类默认语言
  items: GistIndexItem[];
}

export interface NexusFileStorage {
  shardId: string;
  gistId: string;
  gist_file: string;
}

export interface ShardDescriptor {
  id: string;
  gistId: string;
  categoryId?: string;
  categoryName?: string;
  part: number;
  kind: "category" | "large";
  fileCount: number;
  totalBytes: number;
  updated_at: string;
}

export interface ShardManifestItem {
  fileId: string;
  filename: string;
  checksum: string;
  updated_at: string;
  size: number;
  isSecure?: boolean;
}

export interface ShardManifest {
  version: 1;
  shardId: string;
  updated_at: string;
  files: ShardManifestItem[];
}

export interface NexusIndex {
  version?: number;
  updated_at: string;
  categories: GistIndexCategory[];
  shards?: ShardDescriptor[];
}

export interface NexusConfig {
  githubToken: string;
  gistId: string | null; // The ID of the specific Gist used for Nexus
  rootGistId?: string | null;
  legacyGistId?: string | null;
  schemaVersion?: number;
  syncInterval: number; // in minutes
  theme: "dark" | "light" | "auto";
}
