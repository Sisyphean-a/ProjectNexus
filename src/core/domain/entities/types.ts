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
}

export interface GistIndexCategory {
  id: string;
  name: string;
  icon?: string;
  defaultLanguage?: string; // 分类默认语言
  items: GistIndexItem[];
}

export interface NexusIndex {
  updated_at: string;
  categories: GistIndexCategory[];
}

export interface NexusConfig {
  githubToken: string;
  gistId: string | null; // The ID of the specific Gist used for Nexus
  syncInterval: number; // in minutes
  theme: "dark" | "light" | "auto";
}
