import { computed, nextTick, onScopeDispose, ref, watch } from "vue";
import { DECRYPTION_PENDING_PREFIX } from "../../../core/application/services/SyncService";

export const AUTO_SNAPSHOT_DELAY_MS = 30_000;

type LoadingHandle = { destroy: () => void };
type MessageLike = {
  success: (message: string) => void;
  error: (message: string) => void;
  loading: (message: string, options?: { duration: number }) => LoadingHandle;
};
type DialogLike = {
  warning: (options: {
    title: string;
    content: string;
    positiveText: string;
    negativeText?: string;
  }) => void;
};

type SelectedFileLike = {
  id: string;
  title: string;
  gist_file: string;
  isSecure?: boolean;
};

type WorkspaceStoreLike = {
  currentFileList: SelectedFileLike[];
  currentGistId: string | null;
  remoteUpdatedAt: string | null;
  getFileLanguage: (fileId: string) => Promise<string>;
  changeFileLanguage: (fileId: string, language: string) => Promise<boolean>;
  saveFileContent: (fileId: string, content: string) => Promise<void>;
};

type SelectionStoreLike = {
  selectedFileId: string | null;
};

type VaultStoreLike = {
  getFileContent: (fileId: string) => Promise<string>;
  hasPassword: () => boolean;
  updateFileSecureStatus: (fileId: string, nextSecure: boolean) => Promise<void>;
};

type HistoryStoreLike = {
  recordAutoSnapshot: (fileId: string, content: string) => Promise<void>;
  recordManualSnapshot: (fileId: string, content: string) => Promise<void>;
};

export interface UseEditorSessionOptions {
  workspaceStore: WorkspaceStoreLike;
  selectionStore: SelectionStoreLike;
  vaultStore: VaultStoreLike;
  historyStore: HistoryStoreLike;
  message: MessageLike;
  dialog: DialogLike;
}

function getSuffixFromFilename(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === filename.length - 1) {
    return "";
  }
  return filename.slice(lastDotIndex + 1);
}

function sanitizeExtension(rawExtension: string): string {
  return rawExtension.trim().replace(/^\.+/, "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeBaseName(rawName: string): string {
  return rawName.trim().replace(/[\\/:*?"<>|]/g, "_");
}

export function useEditorSession(options: UseEditorSessionOptions) {
  const {
    workspaceStore,
    selectionStore,
    vaultStore,
    historyStore,
    message,
    dialog,
  } = options;

  const code = ref("");
  const language = ref("yaml");
  const isDirty = ref(false);
  const isLoadingContent = ref(false);
  const isReadOnly = ref(false);
  const isSaving = ref(false);
  const fontSize = ref(14);
  const showHistoryPanel = ref(false);
  const showExportModal = ref(false);
  const exportBaseName = ref("");
  const exportExtension = ref("");
  const isExporting = ref(false);
  const isChangingLanguage = ref(false);
  const isProgrammaticUpdate = ref(false);
  const isTogglingSecure = ref(false);

  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let loadRequestId = 0;

  const selectedFile = computed(() => {
    if (!selectionStore.selectedFileId) {
      return null;
    }
    return workspaceStore.currentFileList.find(
      (item) => item.id === selectionStore.selectedFileId,
    ) || null;
  });

  const isDecryptionPending = computed(() => (
    code.value.startsWith(DECRYPTION_PENDING_PREFIX)
  ));

  function clearAutoSaveTimer() {
    if (!autoSaveTimer) {
      return;
    }
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }

  async function loadFileContent(fileId = selectionStore.selectedFileId || "") {
    if (!fileId) {
      return;
    }

    const requestId = ++loadRequestId;
    isLoadingContent.value = true;
    try {
      const [content, savedLanguage] = await Promise.all([
        vaultStore.getFileContent(fileId),
        workspaceStore.getFileLanguage(fileId),
      ]);

      if (requestId !== loadRequestId || selectionStore.selectedFileId !== fileId) {
        return;
      }

      code.value = content;
      isProgrammaticUpdate.value = true;
      language.value = savedLanguage;
      await nextTick();

      if (requestId !== loadRequestId || selectionStore.selectedFileId !== fileId) {
        return;
      }

      isProgrammaticUpdate.value = false;
      isDirty.value = false;
    } catch (error) {
      console.error(error);
      message.error("加载内容失败");
    } finally {
      if (requestId === loadRequestId) {
        isLoadingContent.value = false;
      }
    }
  }

  function openExportModal() {
    if (!selectedFile.value) {
      return;
    }

    exportBaseName.value = selectedFile.value.title?.trim() || "untitled";
    exportExtension.value = getSuffixFromFilename(selectedFile.value.gist_file || "");
    showExportModal.value = true;
  }

  async function confirmExport() {
    if (isExporting.value) {
      return;
    }

    isExporting.value = true;
    try {
      const finalBaseName = sanitizeBaseName(exportBaseName.value) || "untitled";
      const finalExtension = sanitizeExtension(exportExtension.value);
      const finalFilename = finalExtension
        ? `${finalBaseName}.${finalExtension}`
        : finalBaseName;
      const blob = new Blob([code.value ?? ""], {
        type: "text/plain;charset=utf-8",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = downloadUrl;
      anchor.download = finalFilename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);
      showExportModal.value = false;
      message.success("已导出文件");
    } catch (error) {
      console.error(error);
      message.error("导出失败");
    } finally {
      isExporting.value = false;
    }
  }

  async function handleSave() {
    if (!selectionStore.selectedFileId || isSaving.value) {
      return;
    }

    isSaving.value = true;
    const savingMessage = message.loading("保存中...", { duration: 0 });
    try {
      await workspaceStore.saveFileContent(selectionStore.selectedFileId, code.value);
      await historyStore.recordManualSnapshot(selectionStore.selectedFileId, code.value);
      isDirty.value = false;
      message.success("已保存并同步");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      if (errorMessage.includes("Vault password not set")) {
        message.error("保险库密码未设置，请先在侧边栏设置密码后再保存");
      } else {
        message.error(`保存失败: ${errorMessage}`);
      }
      console.error(error);
    } finally {
      savingMessage.destroy();
      isSaving.value = false;
    }
  }

  async function handleToggleSecure() {
    if (!selectionStore.selectedFileId || !selectedFile.value || isTogglingSecure.value) {
      return;
    }

    const isCurrentlySecure = !!selectedFile.value.isSecure;
    if (!isCurrentlySecure && !vaultStore.hasPassword()) {
      dialog.warning({
        title: "需设置保险库密码",
        content: "启用加密前，请先在侧边栏设置保险库密码。",
        positiveText: "知道了",
      });
      return;
    }

    if (isCurrentlySecure && !vaultStore.hasPassword()) {
      message.error("请先设置保险库密码以解密");
      return;
    }

    isTogglingSecure.value = true;
    const action = isCurrentlySecure ? "解密" : "加密";
    const loadingMessage = message.loading(`${action}中...`, { duration: 0 });
    try {
      await vaultStore.updateFileSecureStatus(
        selectionStore.selectedFileId,
        !isCurrentlySecure,
      );
      loadingMessage.destroy();
      message.success(`文件已${action}`);
    } catch (error) {
      loadingMessage.destroy();
      console.error(error);
      const detail = error instanceof Error ? error.message : "未知错误";
      message.error(`${action}失败: ${detail}`);
    } finally {
      isTogglingSecure.value = false;
    }
  }

  async function handleCopyAll() {
    try {
      await navigator.clipboard.writeText(code.value);
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  }

  function markDirty() {
    isDirty.value = true;
  }

  function handleRestoreVersion(content: string) {
    code.value = content;
    isDirty.value = true;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented) {
      return;
    }

    const key = event.key.toLowerCase();
    const isFromCodeMirror = (event.target as HTMLElement | null)?.closest(".cm-editor");
    if ((event.ctrlKey || event.metaKey) && key === "s") {
      if (isFromCodeMirror) {
        return;
      }
      event.preventDefault();
      if (!isReadOnly.value) {
        void handleSave();
      }
    }

    if ((event.ctrlKey || event.metaKey) && key === "g") {
      event.preventDefault();
    }
  }

  watch(
    () => selectionStore.selectedFileId,
    async (selectedFileId) => {
      if (!selectedFileId || !workspaceStore.currentGistId) {
        code.value = "";
        return;
      }
      await loadFileContent(selectedFileId);
    },
    { immediate: true },
  );

  watch(
    () => workspaceStore.remoteUpdatedAt,
    async (newTime, oldTime) => {
      if (!newTime || newTime === oldTime || !selectionStore.selectedFileId) {
        return;
      }
      if (!workspaceStore.currentGistId) {
        return;
      }
      await loadFileContent(selectionStore.selectedFileId);
    },
  );

  watch(code, (newValue) => {
    if (!selectionStore.selectedFileId || isReadOnly.value || isLoadingContent.value) {
      return;
    }
    if (isDecryptionPending.value) {
      return;
    }

    clearAutoSaveTimer();
    autoSaveTimer = setTimeout(async () => {
      if (!selectionStore.selectedFileId) {
        return;
      }
      await historyStore.recordAutoSnapshot(selectionStore.selectedFileId, newValue);
    }, AUTO_SNAPSHOT_DELAY_MS);
  });

  watch(language, async (newLanguage, previousLanguage) => {
    if (!selectionStore.selectedFileId || isLoadingContent.value || isChangingLanguage.value) {
      return;
    }
    if (isProgrammaticUpdate.value || newLanguage === previousLanguage) {
      return;
    }

    isChangingLanguage.value = true;
    const changingMessage = message.loading("更改语言中...", { duration: 0 });
    try {
      const success = await workspaceStore.changeFileLanguage(
        selectionStore.selectedFileId,
        newLanguage,
      );
      changingMessage.destroy();
      if (success) {
        message.success("语言已更改");
        return;
      }
      message.error("更改失败");
      isProgrammaticUpdate.value = true;
      language.value = previousLanguage;
      await nextTick();
      isProgrammaticUpdate.value = false;
    } catch (error) {
      changingMessage.destroy();
      message.error("更改语言失败");
      isProgrammaticUpdate.value = true;
      language.value = previousLanguage;
      await nextTick();
      isProgrammaticUpdate.value = false;
      console.error(error);
    } finally {
      isChangingLanguage.value = false;
    }
  });

  onScopeDispose(() => {
    clearAutoSaveTimer();
  });

  return {
    code,
    language,
    isDirty,
    isLoadingContent,
    isReadOnly,
    isSaving,
    fontSize,
    showHistoryPanel,
    showExportModal,
    exportBaseName,
    exportExtension,
    isExporting,
    isTogglingSecure,
    selectedFile,
    isDecryptionPending,
    loadFileContent,
    openExportModal,
    confirmExport,
    handleSave,
    handleToggleSecure,
    handleCopyAll,
    handleKeyDown,
    handleRestoreVersion,
    markDirty,
  };
}
