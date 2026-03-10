import { defineStore } from "pinia";
import { appContainer } from "../../bootstrap/container";
import { applyRemoteTime, workspaceConfig, workspaceIndex, remoteUpdatedAt } from "./workspaceState";

export const useVaultStore = defineStore("vault", () => {
  function hasPassword() {
    return appContainer.vaultFacade.hasPassword();
  }

  async function setPassword(
    password: string,
    options: { rememberMode?: "memory" | "session" | "trustedDevice" } = {},
  ) {
    await appContainer.vaultFacade.setPassword(password, options);
  }

  async function getFileContent(fileId: string) {
    return appContainer.vaultFacade.getFileContent(fileId);
  }

  async function resetSecureCache() {
    await appContainer.vaultFacade.resetSecureCache(workspaceIndex.value);
  }

  async function updateFileSecureStatus(fileId: string, isSecure: boolean) {
    if (!workspaceConfig.value || !workspaceIndex.value) {
      return;
    }

    const result = await appContainer.vaultFacade.updateFileSecureStatus(
      {
        config: workspaceConfig.value,
        index: workspaceIndex.value,
        lastRemoteUpdatedAt: remoteUpdatedAt.value,
      },
      fileId,
      isSecure,
    );
    applyRemoteTime(result.newRemoteTime);
  }

  return {
    hasPassword,
    setPassword,
    getFileContent,
    resetSecureCache,
    updateFileSecureStatus,
  };
});
