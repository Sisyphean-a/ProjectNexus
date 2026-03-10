import { computed, getCurrentScope, nextTick, onScopeDispose, ref, watch } from "vue";
import { useHistoryStore } from "../stores/useHistoryStore";
import { useSelectionStore } from "../stores/useSelectionStore";
import { useVaultStore } from "../stores/useVaultStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { DECRYPTION_PENDING_PREFIX } from "../../core/application/services/SyncService";

export const AUTO_SNAPSHOT_DELAY_MS = 30_000;

interface EditorSessionDeps {
  selectedFileId: { value: string | null };
  remoteUpdatedAt: { value: string | null };
  currentGistId: { value: string | null };
  getFileContent(fileId: string): Promise<string>;
  getFileLanguage(fileId: string): Promise<string>;
  changeFileLanguage(fileId: string, language: string): Promise<boolean>;
  saveFileContent(fileId: string, content: string): Promise<void>;
  recordAutoSnapshot(fileId: string, content: string): Promise<void>;
  recordManualSnapshot(fileId: string, content: string): Promise<void>;
  hasPassword(): boolean;
  updateFileSecureStatus(fileId: string, isSecure: boolean): Promise<void>;
}

export function createEditorSession(deps: EditorSessionDeps) {
  const code = ref("");
  const language = ref("yaml");
  const isDirty = ref(false);
  const isLoadingContent = ref(false);
  const isReadOnly = ref(false);
  const isSaving = ref(false);
  const fontSize = ref(14);
  const showHistoryPanel = ref(false);
  const isChangingLanguage = ref(false);
  const isProgrammaticUpdate = ref(false);
  const isTogglingSecure = ref(false);
  const isDecryptionPending = computed(() => code.value.startsWith(DECRYPTION_PENDING_PREFIX));

  let autoSnapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let loadRequestId = 0;

  const clearAutoSnapshot = () => {
    if (!autoSnapshotTimer) {
      return;
    }
    clearTimeout(autoSnapshotTimer);
    autoSnapshotTimer = null;
  };

  async function loadSelectedFile(fileId: string | null) {
    const requestId = ++loadRequestId;
    if (!fileId || !deps.currentGistId.value) {
      code.value = "";
      isLoadingContent.value = false;
      return;
    }

    isLoadingContent.value = true;
    try {
      const [content, savedLanguage] = await Promise.all([
        deps.getFileContent(fileId),
        deps.getFileLanguage(fileId),
      ]);
      if (requestId !== loadRequestId) {
        return;
      }

      code.value = content;
      isProgrammaticUpdate.value = true;
      language.value = savedLanguage;
      await nextTick();
      if (requestId !== loadRequestId) {
        return;
      }
      isProgrammaticUpdate.value = false;
      isDirty.value = false;
    } finally {
      if (requestId === loadRequestId) {
        isLoadingContent.value = false;
      }
    }
  }

  async function saveSelectedFile() {
    if (!deps.selectedFileId.value || isSaving.value) {
      return;
    }

    isSaving.value = true;
    try {
      await deps.saveFileContent(deps.selectedFileId.value, code.value);
      await deps.recordManualSnapshot(deps.selectedFileId.value, code.value);
      isDirty.value = false;
    } finally {
      isSaving.value = false;
    }
  }

  async function changeSelectedLanguage(newLanguage: string, previousLanguage: string) {
    if (
      !deps.selectedFileId.value
      || isLoadingContent.value
      || isChangingLanguage.value
      || isProgrammaticUpdate.value
      || newLanguage === previousLanguage
    ) {
      return false;
    }

    isChangingLanguage.value = true;
    try {
      const changed = await deps.changeFileLanguage(deps.selectedFileId.value, newLanguage);
      if (!changed) {
        isProgrammaticUpdate.value = true;
        language.value = previousLanguage;
        await nextTick();
        isProgrammaticUpdate.value = false;
      }
      return changed;
    } catch (error) {
      isProgrammaticUpdate.value = true;
      language.value = previousLanguage;
      await nextTick();
      isProgrammaticUpdate.value = false;
      throw error;
    } finally {
      isChangingLanguage.value = false;
    }
  }

  async function toggleSelectedFileSecure(isCurrentlySecure: boolean) {
    if (!deps.selectedFileId.value || isTogglingSecure.value) {
      return;
    }

    isTogglingSecure.value = true;
    try {
      await deps.updateFileSecureStatus(deps.selectedFileId.value, !isCurrentlySecure);
    } finally {
      isTogglingSecure.value = false;
    }
  }

  const hasVaultPassword = () => deps.hasPassword();

  watch(
    () => deps.selectedFileId.value,
    async (fileId) => {
      await loadSelectedFile(fileId);
    },
  );

  watch(
    () => deps.remoteUpdatedAt.value,
    async (newTime, oldTime) => {
      if (!newTime || newTime === oldTime) {
        return;
      }
      await loadSelectedFile(deps.selectedFileId.value);
    },
  );

  watch(code, (newValue) => {
    if (
      !deps.selectedFileId.value
      || isReadOnly.value
      || isLoadingContent.value
      || isDecryptionPending.value
    ) {
      return;
    }

    clearAutoSnapshot();
    autoSnapshotTimer = setTimeout(async () => {
      if (!deps.selectedFileId.value) {
        return;
      }
      await deps.recordAutoSnapshot(deps.selectedFileId.value, newValue);
    }, AUTO_SNAPSHOT_DELAY_MS);
  });

  if (getCurrentScope()) {
    onScopeDispose(() => {
      clearAutoSnapshot();
    });
  }

  return {
    code,
    language,
    isDirty,
    isLoadingContent,
    isReadOnly,
    isSaving,
    fontSize,
    showHistoryPanel,
    isChangingLanguage,
    isProgrammaticUpdate,
    isTogglingSecure,
    isDecryptionPending,
    clearAutoSnapshot,
    hasVaultPassword,
    loadSelectedFile,
    saveSelectedFile,
    changeSelectedLanguage,
    toggleSelectedFileSecure,
  };
}

export function useEditorSession() {
  const workspaceStore = useWorkspaceStore();
  const selectionStore = useSelectionStore();
  const vaultStore = useVaultStore();
  const historyStore = useHistoryStore();

  return createEditorSession({
    selectedFileId: computed(() => selectionStore.selectedFileId),
    remoteUpdatedAt: computed(() => workspaceStore.remoteUpdatedAt),
    currentGistId: computed(() => workspaceStore.currentGistId),
    getFileContent: (fileId) => vaultStore.getFileContent(fileId),
    getFileLanguage: (fileId) => workspaceStore.getFileLanguage(fileId),
    changeFileLanguage: (fileId, language) => workspaceStore.changeFileLanguage(fileId, language),
    saveFileContent: (fileId, content) => workspaceStore.saveFileContent(fileId, content),
    recordAutoSnapshot: (fileId, content) => historyStore.recordAutoSnapshot(fileId, content),
    recordManualSnapshot: (fileId, content) => historyStore.recordManualSnapshot(fileId, content),
    hasPassword: () => vaultStore.hasPassword(),
    updateFileSecureStatus: (fileId, isSecure) => vaultStore.updateFileSecureStatus(fileId, isSecure),
  });
}

