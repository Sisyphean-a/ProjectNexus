import { computed, ref } from "vue";
import type { NexusConfig, NexusIndex } from "../../core/domain/entities/types";

export const DEFAULT_SYNC_STALE_MS = 5 * 60 * 1000;
export const DEFAULT_SYNC_COOLDOWN_MS = 30 * 1000;

export const workspaceConfig = ref<NexusConfig | null>(null);
export const workspaceIndex = ref<NexusIndex | null>(null);
export const workspaceLoading = ref(false);
export const lastSyncedAt = ref<string | null>(null);
export const lastSyncAttemptAt = ref<string | null>(null);
export const remoteUpdatedAt = ref<string | null>(null);
export const isSyncScheduled = ref(false);
export const syncCooldownMs = ref(DEFAULT_SYNC_COOLDOWN_MS);
export const selectedCategoryId = ref<string | null>(null);
export const selectedFileId = ref<string | null>(null);

export const currentGistId = computed(
  () => workspaceConfig.value?.rootGistId || workspaceConfig.value?.gistId || null,
);

export function parseIsoTime(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ensureDefaultSelection(): void {
  const categories = workspaceIndex.value?.categories || [];
  if (categories.length === 0) {
    selectedCategoryId.value = null;
    selectedFileId.value = null;
    return;
  }

  const selectedExists = selectedCategoryId.value
    ? categories.some((item) => item.id === selectedCategoryId.value)
    : false;

  if (!selectedExists) {
    selectedCategoryId.value = categories[0].id;
    selectedFileId.value = null;
  }
}

export function applyRemoteTime(newRemoteTime?: string): void {
  if (!newRemoteTime) {
    return;
  }
  remoteUpdatedAt.value = newRemoteTime;
  lastSyncedAt.value = new Date().toISOString();
}

export function resetWorkspaceState(): void {
  workspaceIndex.value = null;
  selectedCategoryId.value = null;
  selectedFileId.value = null;
  remoteUpdatedAt.value = null;
  lastSyncedAt.value = null;
}
