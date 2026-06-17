import { defineStore } from "pinia";
import { appContainer } from "../../bootstrap/container";
import { applyRemoteTime, remoteUpdatedAt, workspaceConfig, workspaceIndex } from "./workspaceState";

export const useHistoryStore = defineStore("history", () => {
  function getWorkspaceContext() {
    if (!workspaceConfig.value || !workspaceIndex.value) {
      throw new Error("工作区尚未初始化");
    }
    return {
      config: workspaceConfig.value,
      index: workspaceIndex.value,
      lastRemoteUpdatedAt: remoteUpdatedAt.value,
    };
  }

  async function getFileHistory(fileId: string) {
    return appContainer.historyFacade.getFileHistory(fileId);
  }

  async function recordManualSnapshot(fileId: string, content: string) {
    await appContainer.historyFacade.recordManualSnapshot(fileId, content);
  }

  async function recordRestoreSnapshot(fileId: string, content: string) {
    await appContainer.historyFacade.recordRestoreSnapshot(fileId, content);
  }

  async function recordAutoSnapshot(fileId: string, content: string) {
    try {
      await appContainer.historyFacade.recordAutoSnapshot(fileId, content);
    } catch {
      // no-op
    }
  }

  async function restoreFileContent(fileId: string, content: string) {
    const result = await appContainer.workspaceFacade.saveFileContent(
      getWorkspaceContext(),
      fileId,
      content,
    );
    applyRemoteTime(result.newRemoteTime);
    await recordRestoreSnapshot(fileId, content);
  }

  async function importRemoteHistory(fileId: string, filename: string) {
    const gistId = workspaceConfig.value?.rootGistId || workspaceConfig.value?.gistId;
    if (!gistId) {
      return 0;
    }
    return appContainer.historyFacade.importRemoteHistory(gistId, fileId, filename);
  }

  async function getRemoteHistory() {
    const gistId = workspaceConfig.value?.rootGistId || workspaceConfig.value?.gistId;
    if (!gistId) {
      return [];
    }
    return appContainer.historyFacade.getRemoteHistory(gistId);
  }

  async function getRemoteVersionContent(version: string, filename: string) {
    const gistId = workspaceConfig.value?.rootGistId || workspaceConfig.value?.gistId;
    if (!gistId) {
      return null;
    }
    return appContainer.historyFacade.getRemoteVersionContent(gistId, version, filename);
  }

  return {
    getFileHistory,
    recordManualSnapshot,
    recordRestoreSnapshot,
    recordAutoSnapshot,
    restoreFileContent,
    importRemoteHistory,
    getRemoteHistory,
    getRemoteVersionContent,
  };
});
