import { defineStore } from "pinia";
import { selectedCategoryId, selectedFileId } from "./workspaceState";

export const useSelectionStore = defineStore("selection", () => {
  function selectCategory(categoryId: string | null) {
    selectedCategoryId.value = categoryId;
    if (!categoryId) {
      selectedFileId.value = null;
    }
  }

  function selectFile(fileId: string | null) {
    selectedFileId.value = fileId;
  }

  function resetSelection() {
    selectedCategoryId.value = null;
    selectedFileId.value = null;
  }

  return {
    selectedCategoryId,
    selectedFileId,
    selectCategory,
    selectFile,
    resetSelection,
  };
});
