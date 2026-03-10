import type { IGistRepository } from "../../ports/IGistRepository";
import type { ILocalStore } from "../../ports/ILocalStore";
import type { NexusConfig, NexusIndex, ShardDescriptor } from "../../../domain/entities/types";
import {
  NEXUS_INDEX_FILENAME,
  NEXUS_INDEX_V2_FILENAME,
  NEXUS_SHARDS_FILENAME,
  NEXUS_SHARD_STATE_FILENAME,
} from "./SyncConstants";
import { ShardStateService } from "./ShardStateService";
import type { SyncDownResult } from "./SyncTypes";

type RootResolution = {
  rootGistId: string;
  rootMeta: { updated_at: string };
};

interface SyncDownDependencies {
  gistRepo: Pick<IGistRepository, "findNexusGist" | "getGistFilesByNames">;
  localStore: Pick<ILocalStore, "saveIndex">;
  shardStateService: Pick<
    ShardStateService,
    "buildShardDigest" | "getChangedShardGists" | "parseShardState"
  >;
  pullShardChanges(
    remoteIndex: NexusIndex,
    changedShardGists: Set<string> | null,
  ): Promise<void>;
  migrateLegacyToV2(
    legacyGistId: string,
    legacyIndexContent: string,
  ): Promise<{ rootGistId: string; configUpdates: Partial<NexusConfig> }>;
  resolveAccessibleRootGist(rootGistId: string): Promise<RootResolution>;
  ensureV2Index(index: NexusIndex): NexusIndex;
  parseShards(raw: string | undefined, fallback: ShardDescriptor[]): ShardDescriptor[];
  hydrateShardCategoryNames(index: NexusIndex): void;
  createRootConfigUpdate(
    config: NexusConfig,
    rootGistId: string,
  ): Partial<NexusConfig> | undefined;
}

export class SyncDownCoordinator {
  constructor(private readonly deps: SyncDownDependencies) {}

  async syncDown(
    config: NexusConfig,
    lastRemoteUpdatedAt: string | null,
  ): Promise<SyncDownResult> {
    const initialRootGistId = config.rootGistId || config.gistId;
    const rootGistId = await this.resolveRootGistId(initialRootGistId);
    const resolvedRoot = await this.deps.resolveAccessibleRootGist(rootGistId);
    const remoteTime = resolvedRoot.rootMeta.updated_at;

    if (
      lastRemoteUpdatedAt === remoteTime
      && (config.schemaVersion || 1) >= 2
    ) {
      return {
        index: null,
        synced: false,
        configUpdates: this.deps.createRootConfigUpdate(config, resolvedRoot.rootGistId),
      };
    }

    const rootFiles = await this.deps.gistRepo.getGistFilesByNames(
      resolvedRoot.rootGistId,
      [
        NEXUS_INDEX_V2_FILENAME,
        NEXUS_SHARDS_FILENAME,
        NEXUS_SHARD_STATE_FILENAME,
        NEXUS_INDEX_FILENAME,
      ],
    );
    const v2IndexFile = rootFiles[NEXUS_INDEX_V2_FILENAME];
    if (v2IndexFile?.content) {
      return this.syncV2Index(
        config,
        resolvedRoot.rootGistId,
        remoteTime,
        rootFiles,
        v2IndexFile.content,
        lastRemoteUpdatedAt,
      );
    }

    const legacyIndexContent = rootFiles[NEXUS_INDEX_FILENAME]?.content;
    if (!legacyIndexContent) {
      throw new Error("Root Gist 中缺少 index 文件");
    }

    const migrated = await this.deps.migrateLegacyToV2(
      resolvedRoot.rootGistId,
      legacyIndexContent,
    );
    const rerun = await this.syncDown(
      {
        ...config,
        gistId: migrated.rootGistId,
        rootGistId: migrated.rootGistId,
        schemaVersion: 2,
        legacyGistId: resolvedRoot.rootGistId,
      },
      null,
    );

    rerun.configUpdates = {
      ...(rerun.configUpdates || {}),
      ...migrated.configUpdates,
    };
    return rerun;
  }

  private async resolveRootGistId(rootGistId: string | null): Promise<string> {
    if (rootGistId) {
      return rootGistId;
    }

    const discoveredRoot = await this.deps.gistRepo.findNexusGist();
    if (!discoveredRoot) {
      throw new Error("未找到 Nexus Gist，请先初始化");
    }
    return discoveredRoot;
  }

  private async syncV2Index(
    config: NexusConfig,
    rootGistId: string,
    remoteTime: string,
    rootFiles: Record<string, { content?: string }>,
    v2IndexContent: string,
    lastRemoteUpdatedAt: string | null,
  ): Promise<SyncDownResult> {
    const remoteIndex = this.deps.ensureV2Index(
      JSON.parse(v2IndexContent) as NexusIndex,
    );

    remoteIndex.shards = this.deps.parseShards(
      rootFiles[NEXUS_SHARDS_FILENAME]?.content,
      remoteIndex.shards || [],
    );
    this.deps.hydrateShardCategoryNames(remoteIndex);

    const remoteShardState = this.deps.shardStateService.parseShardState(
      rootFiles[NEXUS_SHARD_STATE_FILENAME]?.content,
    );
    const changedShardGists = this.deps.shardStateService.getChangedShardGists(
      config.shardStateDigest || {},
      remoteShardState,
      lastRemoteUpdatedAt,
    );

    await this.deps.pullShardChanges(remoteIndex, changedShardGists);
    await this.deps.localStore.saveIndex(remoteIndex);

    return {
      index: remoteIndex,
      synced: true,
      gistUpdatedAt: remoteTime,
      configUpdates: {
        ...(this.deps.createRootConfigUpdate(config, rootGistId) || {}),
        shardStateDigest: this.deps.shardStateService.buildShardDigest(remoteShardState),
      },
    };
  }
}
