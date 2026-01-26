import { Dexie, type Table } from "dexie";

export interface LocalFile {
  id: string; // Internal ID (Nexus ID)
  gist_filename: string; // Filename in Gist (e.g. "abcde.yaml")
  title: string;
  content: string;
  language: string;
  tags: string[];
  updated_at: string; // ISO string
  synced_at?: string | null; // When it was last synced with Gist
  is_dirty: boolean; // If true, needs to be pushed to Gist
  checksum: string;
}

export interface HistoryEntry {
  id?: number; // Auto-increment
  fileId: string;
  content: string;
  timestamp: string; // ISO string
  type: "manual" | "auto" | "sync" | "restore";
  note?: string;
}

export class NexusDatabase extends Dexie {
  files!: Table<LocalFile>;
  history!: Table<HistoryEntry>;

  constructor() {
    super("NexusDB");
    
    // Version 2: Initial Schema
    this.version(2).stores({
      files: "id, gist_filename, title, *tags, is_dirty",
    });

    // Version 3: Add History
    this.version(3).stores({
      files: "id, gist_filename, title, *tags, is_dirty",
      history: "++id, fileId, timestamp, type",
    });
  }
}

export const nexusDb = new NexusDatabase();

