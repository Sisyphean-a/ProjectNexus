import { computed } from "vue";
import { useSyncStore } from "../stores/useSyncStore";
import { useVaultStore } from "../stores/useVaultStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";

export type VaultRememberMode = "memory" | "session" | "trustedDevice";

interface SidebarActionsDeps {
  workspaceIndex: { value: unknown | null };
  setPassword(password: string, options: { rememberMode: VaultRememberMode }): Promise<void>;
  resetSecureCache(): Promise<void>;
  sync(force?: boolean): Promise<void>;
}

export function createSidebarActions(deps: SidebarActionsDeps) {
  async function saveVaultPassword(
    password: string,
    rememberMode: VaultRememberMode,
  ) {
    await deps.setPassword(password, { rememberMode });
    if (!deps.workspaceIndex.value) {
      return;
    }
    await deps.resetSecureCache();
    await deps.sync(true);
  }

  return {
    saveVaultPassword,
  };
}

export function useSidebarActions() {
  const workspaceStore = useWorkspaceStore();
  const vaultStore = useVaultStore();
  const syncStore = useSyncStore();

  return createSidebarActions({
    workspaceIndex: computed(() => workspaceStore.index),
    setPassword: (password, options) => vaultStore.setPassword(password, options),
    resetSecureCache: () => vaultStore.resetSecureCache(),
    sync: (force) => syncStore.sync(force),
  });
}
