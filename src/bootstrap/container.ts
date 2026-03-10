import { gistRepository, localStoreRepository, fileRepository, localHistoryRepository } from "../infrastructure";
import { SyncService } from "../core/application/services/SyncService";
import { FileService } from "../core/application/services/FileService";
import { WebCryptoProvider } from "../infrastructure/security/WebCryptoProvider";

const cryptoProvider = new WebCryptoProvider();
const syncService = new SyncService(
  gistRepository,
  localStoreRepository,
  fileRepository,
  cryptoProvider,
);
const fileService = new FileService(fileRepository, syncService);

export const appContainer = {
  gistRepository,
  localStoreRepository,
  fileRepository,
  localHistoryRepository,
  cryptoProvider,
  syncService,
  fileService,
} as const;

export {
  cryptoProvider,
  syncService,
  fileService,
  gistRepository,
  localStoreRepository,
  fileRepository,
  localHistoryRepository,
};
