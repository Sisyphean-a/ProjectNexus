import type { NexusConfig, NexusIndex } from '../../domain/entities/types';

export interface ILocalStore {
  getConfig(): Promise<NexusConfig>;
  saveConfig(config: Partial<NexusConfig>): Promise<void>;
  getIndex(): Promise<NexusIndex | null>;
  saveIndex(index: NexusIndex): Promise<void>;
  getCache(filename: string): Promise<string | null>;
  saveCache(filename: string, content: string): Promise<void>;
}
