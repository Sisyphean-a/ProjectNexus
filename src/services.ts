import { gistRepository, localStoreRepository, fileRepository } from './infrastructure';
import { SyncService } from './core/application/services/SyncService';
import { FileService } from './core/application/services/FileService';
import { WebCryptoProvider } from './infrastructure/security/WebCryptoProvider';

export const cryptoProvider = new WebCryptoProvider();
export const syncService = new SyncService(gistRepository, localStoreRepository, fileRepository, cryptoProvider);
export const fileService = new FileService(fileRepository, syncService);
