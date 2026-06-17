<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useDialog, useMessage } from "naive-ui";
import EditorPaneContent from "./editor/EditorPaneContent.vue";
import EditorPaneToolbar from "./editor/EditorPaneToolbar.vue";
import EditorPaneExportModal from "./editor/EditorPaneExportModal.vue";
import VersionHistory from "./VersionHistory.vue";
import { useEditorSession } from "./composables/useEditorSession";
import { useThemeStore } from "../../stores/useThemeStore";
import { useWorkspaceStore } from "../../presentation/stores/useWorkspaceStore";
import { useSelectionStore } from "../../presentation/stores/useSelectionStore";
import { useVaultStore } from "../../presentation/stores/useVaultStore";
import { useHistoryStore } from "../../presentation/stores/useHistoryStore";

const emit = defineEmits<{
  "open-search": [];
}>();

const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
const vaultStore = useVaultStore();
const historyStore = useHistoryStore();
const themeStore = useThemeStore();
const message = useMessage();
const dialog = useDialog();

const session = useEditorSession({
  selectionStore,
  workspaceStore,
  vaultStore,
  historyStore,
  message,
  dialog,
});

const showExportModal = ref(false);
const exportBaseName = ref("");
const exportExtension = ref("");
const isExporting = ref(false);

onMounted(() => {
  if (selectionStore.selectedFileId && workspaceStore.currentGistId) {
    void session.loadFileContent();
  }
});

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

async function openExportModal() {
  if (!session.selectedFile.value) {
    return;
  }

  exportBaseName.value = session.selectedFile.value.title?.trim() || "untitled";
  exportExtension.value = getSuffixFromFilename(
    session.selectedFile.value.gist_file || "",
  );
  showExportModal.value = true;
  await nextTick();
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

    const blob = new Blob([session.code.value ?? ""], {
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
    if (!session.isReadOnly.value) {
      void session.handleSave();
    }
  }

  if ((event.ctrlKey || event.metaKey) && key === "g") {
    event.preventDefault();
  }
}
</script>

<template>
  <div class="h-full flex flex-col relative" @keydown="handleKeyDown">
    <EditorPaneToolbar
      :selected-file="session.selectedFile.value"
      :language="session.language.value"
      :is-dirty="session.isDirty.value"
      :is-read-only="session.isReadOnly.value"
      :is-saving="session.isSaving.value"
      :is-toggling-secure="session.isTogglingSecure.value"
      :font-size="session.fontSize.value"
      :theme-mode="themeStore.mode"
      :is-dark="themeStore.isDark"
      @update:language="session.language.value = $event"
      @update:isReadOnly="session.isReadOnly.value = $event"
      @update:fontSize="session.fontSize.value = $event"
      @show-history="session.showHistoryPanel.value = true"
      @copy-all="session.handleCopyAll"
      @export-file="openExportModal"
      @save="session.handleSave"
      @toggle-secure="session.handleToggleSecure"
      @open-search="emit('open-search')"
      @toggle-theme="themeStore.toggleTheme()"
    />

    <EditorPaneContent
      :selected-file="session.selectedFile.value"
      :code="session.code.value"
      :language="session.language.value"
      :is-dark="themeStore.isDark"
      :font-size="session.fontSize.value"
      :is-read-only="session.isReadOnly.value"
      :is-loading-content="session.isLoadingContent.value"
      :is-decryption-pending="session.isDecryptionPending.value"
      @update:code="session.code.value = $event"
      @save="session.handleSave"
      @dirty="session.isDirty.value = true"
    />

    <EditorPaneExportModal
      v-model:show="showExportModal"
      v-model:base-name="exportBaseName"
      v-model:extension="exportExtension"
      :is-exporting="isExporting"
      :is-dark="themeStore.isDark"
      @confirm="confirmExport"
    />

    <VersionHistory
      v-model:show="session.showHistoryPanel.value"
      :filename="session.selectedFile.value?.gist_file || ''"
      :file-id="session.selectedFile.value?.id"
      :current-content="session.code.value"
      :language="session.language.value"
      @restore="session.handleRestoreVersion"
    />
  </div>
</template>

