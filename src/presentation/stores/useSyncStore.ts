import { defineStore } from "pinia";
import { appContainer } from "../../bootstrap/container";
import { useAuthStore } from "../../stores/useAuthStore";
import {
  applyRemoteTime,
  DEFAULT_SYNC_STALE_MS,
  ensureDefaultSelection,
  isSyncScheduled,
  lastSyncAttemptAt,
  lastSyncedAt,
  parseIsoTime,
  remoteUpdatedAt,
  resetWorkspaceState,
  syncCooldownMs,
  workspaceConfig,
  workspaceIndex,
  workspaceLoading,
} from "./workspaceState";

export const useSyncStore = defineStore("sync", () => {
  const authStore = useAuthStore();
  let activeSyncPromise: Promise<void> | null = null;

  async function applySyncResult(result: {
    synced: boolean;
    index: typeof workspaceIndex.value;
    gistUpdatedAt?: string;
    configUpdates?: Record<string, unknown> | null;
  }) {
    if (result.configUpdates) {
      workspaceConfig.value = await appContainer.workspaceFacade.updateConfig(
        { config: workspaceConfig.value },
        result.configUpdates,
      );
    }

    if (result.synced && result.index) {
      workspaceIndex.value = result.index;
    }

    if (result.synced) {
      applyRemoteTime(result.gistUpdatedAt || result.index?.updated_at);
    }

    ensureDefaultSelection();
  }

  async function runSync(force: boolean, purgeLocalBeforeSync: boolean) {
    if (!authStore.isAuthenticated) {
      throw new Error("未认证");
    }

    if (activeSyncPromise) {
      await activeSyncPromise;
      if (!force && !purgeLocalBeforeSync) {
        return;
      }
    }

    activeSyncPromise = (async () => {
      workspaceLoading.value = true;
      lastSyncAttemptAt.value = new Date().toISOString();
      try {
        const result = purgeLocalBeforeSync
          ? await appContainer.syncFacade.forcePullWorkspace(workspaceConfig.value)
          : await appContainer.syncFacade.syncWorkspace(
              workspaceConfig.value,
              force ? null : remoteUpdatedAt.value,
              { force, purgeLocalBeforeSync: false },
            );

        if (purgeLocalBeforeSync) {
          resetWorkspaceState();
        }
        await applySyncResult(result);
      } finally {
        workspaceLoading.value = false;
        activeSyncPromise = null;
      }
    })();

    await activeSyncPromise;
  }

  async function sync(force = false) {
    await runSync(force, false);
  }

  async function forcePullFromRemote() {
    await runSync(true, true);
  }

  async function syncIfStale(maxStaleMs = DEFAULT_SYNC_STALE_MS) {
    if (!authStore.isAuthenticated) {
      return false;
    }
    if (activeSyncPromise) {
      await activeSyncPromise;
      return false;
    }

    const now = Date.now();
    const lastAttemptMs = parseIsoTime(lastSyncAttemptAt.value);
    if (lastAttemptMs > 0 && now - lastAttemptMs < syncCooldownMs.value) {
      return false;
    }

    const lastSuccessMs = parseIsoTime(lastSyncedAt.value);
    if (lastSuccessMs > 0 && now - lastSuccessMs < maxStaleMs) {
      return false;
    }

    isSyncScheduled.value = true;
    try {
      await sync();
      return true;
    } finally {
      isSyncScheduled.value = false;
    }
  }

  async function repairShards(options = {}) {
    if (!workspaceIndex.value || !workspaceConfig.value) {
      throw new Error("当前未初始化 root gist 或 index");
    }
    const gistId = workspaceConfig.value.rootGistId || workspaceConfig.value.gistId;
    if (!gistId) {
      throw new Error("当前未初始化 root gist 或 index");
    }
    workspaceLoading.value = true;
    try {
      const result = await appContainer.syncFacade.repairShards(
        gistId,
        workspaceIndex.value,
        options,
      );
      if (result.applied) {
        applyRemoteTime(result.rootUpdatedAt || new Date().toISOString());
      }
      return result;
    } finally {
      workspaceLoading.value = false;
    }
  }

  return {
    lastSyncedAt,
    lastSyncAttemptAt,
    remoteUpdatedAt,
    isSyncScheduled,
    syncCooldownMs,
    apiRateLimit: appContainer.syncFacade.getRateLimit(),
    sync,
    forcePullFromRemote,
    syncIfStale,
    repairShards,
  };
});
