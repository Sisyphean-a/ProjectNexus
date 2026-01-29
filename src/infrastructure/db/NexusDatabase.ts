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
  is_secure?: number; // 0 or 1 (boolean) - Dexie indexes boolean easier as number sometimes or just use boolean but store allows indexing.
  // Actually Dexie supports boolean. Let's use boolean? Or number for safer indexing?
  // Let's use boolean in interface but stored as is.
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
      history: "++id, fileId, timestamp, type, [fileId+timestamp]",
    });

    // Version 4: Add is_secure
    this.version(4)
      .stores({
        files: "id, gist_filename, title, *tags, is_dirty, is_secure",
      })
      .upgrade((tx) => {
        // Upgrade script if needed, e.g. set default to false (0 or false)
        return tx.table("files").toCollection().modify({ is_secure: 0 }); // Use 0 for false if we stick to number, or false.
        // Let's stick to boolean in TS, Dexie handles it. But for upgrade modify, false is fine.
      });
  }
}

export const nexusDb = new NexusDatabase();
