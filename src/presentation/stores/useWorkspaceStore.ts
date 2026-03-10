import { computed } from "vue";
import { defineStore } from "pinia";
import { appContainer } from "../../bootstrap/container";
import type { NexusConfig } from "../../core/domain/entities/types";
import { useSelectionStore } from "./useSelectionStore";
import {
  applyRemoteTime,
  currentGistId,
  ensureDefaultSelection,
  remoteUpdatedAt,
  selectedCategoryId,
  selectedFileId,
  workspaceConfig,
  workspaceIndex,
  workspaceLoading,
} from "./workspaceState";

export const useWorkspaceStore = defineStore("workspace", () => {
  const selectionStore = useSelectionStore();

  const currentCategory = computed(() => {
    if (!workspaceIndex.value || !selectedCategoryId.value) {
      return null;
    }
    return (
      workspaceIndex.value.categories.find(
        (item) => item.id === selectedCategoryId.value,
      ) || null
    );
  });

  const currentFileList = computed(() => currentCategory.value?.items || []);

  function getContext() {
    if (!workspaceConfig.value || !workspaceIndex.value) {
      throw new Error("工作区尚未初始化");
    }
    return {
      config: workspaceConfig.value,
      index: workspaceIndex.value,
      lastRemoteUpdatedAt: remoteUpdatedAt.value,
    };
  }

  async function init() {
    const result = await appContainer.workspaceFacade.initWorkspace();
    workspaceConfig.value = result.config;
    workspaceIndex.value = result.index;
    ensureDefaultSelection();
  }

  async function updateConfig(updates: Partial<NexusConfig>) {
    workspaceConfig.value = await appContainer.workspaceFacade.updateConfig(
      { config: workspaceConfig.value },
      updates,
    );
  }

  async function initializeGist() {
    workspaceLoading.value = true;
    try {
      const result = await appContainer.workspaceFacade.initializeGist();
      workspaceConfig.value = result.config;
      workspaceIndex.value = result.index;
      selectedCategoryId.value = "default";
      selectedFileId.value = null;
    } finally {
      workspaceLoading.value = false;
    }
  }

  async function addCategory(
    name: string,
    icon = "folder",
    defaultLanguage = "yaml",
  ) {
    const result = await appContainer.workspaceFacade.addCategory(
      getContext(),
      name,
      icon,
      defaultLanguage,
    );
    applyRemoteTime(result.newRemoteTime);
    selectionStore.selectCategory(result.category.id);
    selectionStore.selectFile(null);
    return result.category;
  }

  async function updateCategory(
    id: string,
    updates: { name?: string; icon?: string; defaultLanguage?: string },
  ) {
    const result = await appContainer.workspaceFacade.updateCategory(
      getContext(),
      id,
      updates,
    );
    applyRemoteTime(result.newRemoteTime);
  }

  async function deleteCategory(id: string) {
    const result = await appContainer.workspaceFacade.deleteCategory(getContext(), id);
    applyRemoteTime(result.newRemoteTime);
    if (selectedCategoryId.value === id) {
      ensureDefaultSelection();
    }
    return {
      deletedFiles: result.deletedFiles,
      failedFiles: result.failedFiles,
    };
  }

  async function addFile(
    categoryId: string,
    title: string,
    language?: string,
    initialContent = "",
  ) {
    const category = workspaceIndex.value?.categories.find((item) => item.id === categoryId);
    const finalLanguage = language || category?.defaultLanguage || "yaml";
    const result = await appContainer.workspaceFacade.addFile(
      getContext(),
      categoryId,
      title,
      finalLanguage,
      initialContent,
    );
    applyRemoteTime(result.newRemoteTime);
    selectionStore.selectFile(result.file.id);
    return {
      id: result.file.id,
      title: result.file.title,
      gist_file: result.file.filename,
      language: result.file.language,
      tags: result.file.tags,
    };
  }

  async function saveFileContent(fileId: string, content: string) {
    const result = await appContainer.workspaceFacade.saveFileContent(
      getContext(),
      fileId,
      content,
    );
    applyRemoteTime(result.newRemoteTime);
  }

  async function updateFile(
    fileId: string,
    updates: { title?: string; tags?: string[] },
  ) {
    const result = await appContainer.workspaceFacade.updateFile(
      getContext(),
      fileId,
      updates,
    );
    applyRemoteTime(result.newRemoteTime);
  }

  async function deleteFile(categoryId: string, fileId: string) {
    const result = await appContainer.workspaceFacade.deleteFile(
      getContext(),
      categoryId,
      fileId,
    );
    applyRemoteTime(result.newRemoteTime);
    if (selectedFileId.value === fileId) {
      selectedFileId.value = null;
    }
  }

  async function changeFileLanguage(fileId: string, newLanguage: string) {
    const result = await appContainer.workspaceFacade.changeFileLanguage(
      getContext(),
      fileId,
      newLanguage,
    );
    applyRemoteTime(result.newRemoteTime);
    return result.success;
  }

  async function getFileLanguage(fileId: string) {
    return appContainer.workspaceFacade.getFileLanguage(fileId);
  }

  return {
    config: workspaceConfig,
    index: workspaceIndex,
    isLoading: workspaceLoading,
    currentGistId,
    currentCategory,
    currentFileList,
    remoteUpdatedAt,
    init,
    updateConfig,
    initializeGist,
    addCategory,
    updateCategory,
    deleteCategory,
    addFile,
    saveFileContent,
    updateFile,
    deleteFile,
    changeFileLanguage,
    getFileLanguage,
  };
});
