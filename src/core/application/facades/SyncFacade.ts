import type { NexusConfig, NexusIndex } from "../../domain/entities/types";
import type { RepairShardsOptions } from "../services/SyncService";
import type { SyncService } from "../services/SyncService";

interface SyncGistGateway {
  rateLimit: { limit: number; remaining: number; resetAt: number };
  fetchGist(gistId: string): Promise<{ updated_at: string }>;
  findNexusGist(): Promise<string | null>;
}

interface SyncLocalStore {
  saveConfig(config: Partial<NexusConfig>): Promise<void>;
  getConfig(): Promise<NexusConfig>;
  clearIndexAndCaches(): Promise<void>;
}

interface SyncFileRepo {
  clearAll(): Promise<void>;
}

interface SyncHistoryRepo {
  clearAll(): Promise<void>;
}

export class SyncFacade {
  constructor(
    private gistRepository: SyncGistGateway,
    private localStoreRepository: SyncLocalStore,
    private fileRepository: SyncFileRepo,
    private historyRepository: SyncHistoryRepo,
    private syncService: SyncService,
  ) {}

  getRateLimit() {
    return this.gistRepository.rateLimit;
  }

  async syncWorkspace(
    config: NexusConfig | null,
    lastRemoteUpdatedAt: string | null,
    options: { force: boolean; purgeLocalBeforeSync: boolean },
  ) {
    let resolvedConfig = config ?? (await this.localStoreRepository.getConfig());

    if (options.purgeLocalBeforeSync) {
      resolvedConfig = await this.resolveRemoteRootBeforeForcePull(resolvedConfig);
      await this.clearLocalDataForForcePull();
    }

    return this.syncService.syncDown(
      resolvedConfig,
      options.force ? null : lastRemoteUpdatedAt,
    );
  }

  async forcePullWorkspace(config: NexusConfig | null) {
    return this.syncWorkspace(config, null, {
      force: true,
      purgeLocalBeforeSync: true,
    });
  }

  async saveIndex(
    gistId: string,
    index: NexusIndex,
    lastRemoteUpdatedAt: string | null,
    forceOverwrite = false,
  ): Promise<string> {
    return this.syncService.pushIndex(
      gistId,
      index,
      lastRemoteUpdatedAt,
      forceOverwrite,
    );
  }

  async repairShards(
    rootGistId: string,
    index: NexusIndex,
    options: RepairShardsOptions = {},
  ) {
    return this.syncService.repairShards(rootGistId, index, options);
  }

  private async clearLocalDataForForcePull(): Promise<void> {
    await Promise.all([
      this.fileRepository.clearAll(),
      this.historyRepository.clearAll(),
      this.localStoreRepository.clearIndexAndCaches(),
    ]);
  }

  private async resolveRemoteRootBeforeForcePull(
    config: NexusConfig,
  ): Promise<NexusConfig> {
    const configuredRoot = config.rootGistId || config.gistId || null;
    if (configuredRoot) {
      try {
        await this.gistRepository.fetchGist(configuredRoot);
        return config;
      } catch (error) {
        if (!this.isGistNotFoundError(error)) {
          throw error;
        }
      }
    }

    const discoveredRoot = await this.gistRepository.findNexusGist();
    if (!discoveredRoot) {
      if (configuredRoot) {
        throw new Error(
          `配置的远程 Gist 不存在或无权限访问（${configuredRoot}），且未找到可用 Nexus Gist`,
        );
      }
      throw new Error("未找到可用 Nexus Gist，请先初始化");
    }

    const updates = {
      rootGistId: discoveredRoot,
      gistId: discoveredRoot,
    };
    await this.localStoreRepository.saveConfig(updates);
    return { ...config, ...updates };
  }

  private isGistNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }
    const status = (error as { status?: number }).status;
    if (status === 404) {
      return true;
    }
    const message = (error as { message?: string }).message || "";
    return message.includes("Not Found");
  }
}
