import { gistRepository, localStoreRepository, fileRepository } from './infrastructure';
import { SyncService } from './core/application/services/SyncService';
import { FileService } from './core/application/services/FileService';

export const syncService = new SyncService(gistRepository, localStoreRepository, fileRepository);
export const fileService = new FileService(fileRepository, syncService);
