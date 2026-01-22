import Dexie, { type Table } from 'dexie';

export interface LocalFile {
  id: string; // Internal ID (Nexus ID)
  gist_filename: string; // Filename in Gist (e.g. "abcde.yaml")
  title: string;
  content: string;
  language: string;
  tags: string[];
  updated_at: string; // ISO string
  synced_at?: string; // When it was last synced with Gist
  is_dirty: boolean; // If true, needs to be pushed to Gist
}

export class NexusDatabase extends Dexie {
  files!: Table<LocalFile>;

  constructor() {
    super('NexusDB');
    this.version(1).stores({
      files: 'id, gist_filename, title, *tags, is_dirty' // Primary key and indexes
    });
  }
}

export const db = new Dexie('NexusDB') as NexusDatabase; // Re-declare for better typing if needed, or just new NexusDatabase()
// Actually, standard Dexie pattern:
export const nexusDb = new NexusDatabase();
