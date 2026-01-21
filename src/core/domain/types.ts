export interface GistFile {
    id: string; // Unique ID (often filename or generated)
    filename: string;
    content: string;
    language?: string;
    updated_at?: string;
    tags?: string[];
    description?: string;
  }
  
  export interface GistIndexCategory {
    id: string;
    name: string;
    icon?: string;
    items: GistIndexItem[];
  }
  
  export interface GistIndexItem {
    id: string;
    title: string;
    gist_file: string; // Filename in the Gist
    tags?: string[];
  }
  
  export interface NexusIndex {
    updated_at: string;
    categories: GistIndexCategory[];
  }
  
  export interface NexusConfig {
    githubToken: string;
    gistId: string | null; // The ID of the specific Gist used for Nexus
    syncInterval: number; // in minutes
    theme: 'dark' | 'light' | 'auto';
  }
  
  export interface IGistRepository {
    verifyToken(token: string): Promise<boolean>;
    fetchGist(gistId: string): Promise<any>;
    findNexusGist(): Promise<string | null>; // Returns gist ID if found
    createNexusGist(initialIndex: NexusIndex): Promise<string>; // Returns new gist ID
    updateGistFile(gistId: string, filename: string, content: string | null): Promise<void>; // null content for delete
    getGistContent(gistId: string): Promise<Record<string, GistFile>>;
  }
  
  export interface ILocalStore {
    getConfig(): Promise<NexusConfig>;
    saveConfig(config: Partial<NexusConfig>): Promise<void>;
    getIndex(): Promise<NexusIndex | null>;
    saveIndex(index: NexusIndex): Promise<void>;
    getCache(filename: string): Promise<string | null>;
    saveCache(filename: string, content: string): Promise<void>;
  }
