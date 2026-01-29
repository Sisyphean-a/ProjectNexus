import type { IFileRepository } from '../../core/application/ports/IFileRepository';
import { NexusFile } from '../../core/domain/entities/NexusFile';
import { nexusDb, type LocalFile } from './NexusDatabase';

export class LocalFileRepository implements IFileRepository {
  
  async save(file: NexusFile): Promise<void> {
    await nexusDb.files.put(this.toRecord(file));
  }

  async saveBulk(files: NexusFile[]): Promise<void> {
    const records = files.map(f => this.toRecord(f));
    await nexusDb.files.bulkPut(records);
  }

  async get(id: string): Promise<NexusFile | null> {
    const record = await nexusDb.files.get(id);
    return record ? this.toEntity(record) : null;
  }

  async delete(id: string): Promise<void> {
    await nexusDb.files.delete(id);
  }

  private toRecord(file: NexusFile): LocalFile {
    return {
      id: file.id,
      gist_filename: file.filename,
      title: file.title,
      content: file.content,
      language: file.language,
      tags: file.tags,
      updated_at: file.updatedAt,
      is_dirty: file.isDirty,
      checksum: file.checksum,
      synced_at: file.lastSyncedAt,
      is_secure: file.isSecure ? 1 : 0
    };
  }

  private toEntity(record: LocalFile): NexusFile {
    return new NexusFile(
      record.id,
      record.title,
      record.content,
      record.language,
      record.tags,
      record.updated_at,
      record.is_dirty,
      record.checksum,
      record.synced_at,
      !!record.is_secure
    );
  }
}
