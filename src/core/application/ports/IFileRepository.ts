import { NexusFile } from '../../domain/entities/NexusFile';

export interface IFileRepository {
  save(file: NexusFile): Promise<void>;
  saveBulk(files: NexusFile[]): Promise<void>;
  get(id: string): Promise<NexusFile | null>;
  delete(id: string): Promise<void>;
  // getDirtyFiles(): Promise<NexusFile[]>; // Future use
}
