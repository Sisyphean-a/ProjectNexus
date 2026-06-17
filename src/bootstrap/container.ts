import {
  GistRepository,
  LocalFileRepository,
  LocalHistoryRepository,
  LocalStoreRepository,
} from "../infrastructure";
import { WebCryptoProvider } from "../infrastructure/security/WebCryptoProvider";
import { SyncService } from "../core/application/services/SyncService";
import { FileService } from "../core/application/services/FileService";
import { AuthFacade } from "../core/application/facades/AuthFacade";
import { WorkspaceFacade } from "../core/application/facades/WorkspaceFacade";
import { SyncFacade } from "../core/application/facades/SyncFacade";
import { HistoryFacade } from "../core/application/facades/HistoryFacade";
import { VaultFacade } from "../core/application/facades/VaultFacade";

const gistRepository = new GistRepository();
const localStoreRepository = new LocalStoreRepository();
const fileRepository = new LocalFileRepository();
const localHistoryRepository = new LocalHistoryRepository();
const cryptoProvider = new WebCryptoProvider();
const syncService = new SyncService(
  gistRepository,
  localStoreRepository,
  fileRepository,
  cryptoProvider,
);
const fileService = new FileService(fileRepository, syncService);
const authFacade = new AuthFacade(gistRepository, localStoreRepository);
const workspaceFacade = new WorkspaceFacade(
  localStoreRepository,
  fileRepository,
  localHistoryRepository,
  syncService,
  fileService,
);
const syncFacade = new SyncFacade(
  gistRepository,
  localStoreRepository,
  fileRepository,
  localHistoryRepository,
  syncService,
);
const historyFacade = new HistoryFacade(
  localHistoryRepository,
  gistRepository,
);
const vaultFacade = new VaultFacade(
  cryptoProvider,
  fileRepository,
  syncService,
);

export const appContainer = {
  gistRepository,
  localStoreRepository,
  fileRepository,
  localHistoryRepository,
  cryptoProvider,
  syncService,
  fileService,
  authFacade,
  workspaceFacade,
  syncFacade,
  historyFacade,
  vaultFacade,
} as const;
