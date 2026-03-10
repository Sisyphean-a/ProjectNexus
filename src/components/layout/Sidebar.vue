<script setup lang="ts">
import { NDropdown, useDialog, useMessage } from "naive-ui";
import { useSidebarActions } from "./composables/useSidebarActions";
import SidebarActionsPanel from "./sidebar/SidebarActionsPanel.vue";
import SidebarCategoryModal from "./sidebar/SidebarCategoryModal.vue";
import SidebarCategoryTree from "./sidebar/SidebarCategoryTree.vue";
import SidebarVaultSettingsModal from "./sidebar/SidebarVaultSettingsModal.vue";
import { useSelectionStore } from "../../presentation/stores/useSelectionStore";
import { useSyncStore } from "../../presentation/stores/useSyncStore";
import { useVaultStore } from "../../presentation/stores/useVaultStore";
import { useWorkspaceStore } from "../../presentation/stores/useWorkspaceStore";
import { useThemeStore } from "../../stores/useThemeStore";

const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
const syncStore = useSyncStore();
const vaultStore = useVaultStore();
const themeStore = useThemeStore();
const message = useMessage();
const dialog = useDialog();

const sidebarActions = useSidebarActions({
  workspaceStore,
  selectionStore,
  syncStore,
  vaultStore,
  message,
  dialog,
});
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="p-4 flex items-center space-x-2 border-b transition-colors duration-200" :class="themeStore.isDark ? 'border-slate-700' : 'border-slate-200'">
      <div class="i-heroicons-cube-transparent w-6 h-6 text-blue-500"></div>
      <span class="font-bold text-lg tracking-wide" :class="themeStore.isDark ? 'text-white' : 'text-slate-800'">NEXUS</span>
    </div>

    <SidebarCategoryTree
      v-if="workspaceStore.index"
      :categories="workspaceStore.index.categories"
      :selected-category-id="selectionStore.selectedCategoryId"
      :is-dark="themeStore.isDark"
      @select-category="sidebarActions.selectCategory"
      @open-context-menu="sidebarActions.openContextMenu"
    />

    <SidebarActionsPanel
      :has-index="!!workspaceStore.index"
      :is-loading="workspaceStore.isLoading"
      :is-dark="themeStore.isDark"
      :is-sync-busy="sidebarActions.isSyncBusy.value"
      :is-syncing="sidebarActions.isSyncing.value"
      :is-force-pulling="sidebarActions.isForcePulling.value"
      :is-repairing="sidebarActions.isRepairing.value"
      :api-rate-limit="syncStore.apiRateLimit"
      @initialize="sidebarActions.handleInitialize"
      @show-add-modal="sidebarActions.showAddModal.value = true"
      @show-security-modal="sidebarActions.showSecurityModal.value = true"
      @repair-shards="sidebarActions.handleRepairShards"
      @sync="sidebarActions.handleSync"
      @force-pull="sidebarActions.handleForcePull"
    />

    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="sidebarActions.contextMenuX.value"
      :y="sidebarActions.contextMenuY.value"
      :options="sidebarActions.contextMenuOptions"
      :show="sidebarActions.showContextMenu.value"
      @select="sidebarActions.handleContextMenuSelect"
      @clickoutside="sidebarActions.closeContextMenu"
    />

    <SidebarCategoryModal
      :show="sidebarActions.showAddModal.value"
      title="新建分类"
      :name="sidebarActions.newCategoryName.value"
      :default-language="sidebarActions.newCategoryDefaultLanguage.value"
      confirm-text="创建"
      :is-loading="sidebarActions.isAdding.value"
      @update:show="sidebarActions.showAddModal.value = $event"
      @update:name="sidebarActions.newCategoryName.value = $event"
      @update:default-language="sidebarActions.newCategoryDefaultLanguage.value = $event"
      @confirm="sidebarActions.handleAddCategory"
    />

    <SidebarCategoryModal
      :show="sidebarActions.showEditModal.value"
      title="编辑分类"
      :name="sidebarActions.editCategoryName.value"
      :default-language="sidebarActions.editCategoryDefaultLanguage.value"
      confirm-text="保存"
      @update:show="sidebarActions.showEditModal.value = $event"
      @update:name="sidebarActions.editCategoryName.value = $event"
      @update:default-language="sidebarActions.editCategoryDefaultLanguage.value = $event"
      @confirm="sidebarActions.handleEditCategory"
    />

    <SidebarVaultSettingsModal
      :show="sidebarActions.showSecurityModal.value"
      :password="sidebarActions.vaultPasswordInput.value"
      :remember-mode="sidebarActions.rememberVaultMode.value"
      :remember-mode-options="sidebarActions.rememberModeOptions"
      @update:show="sidebarActions.showSecurityModal.value = $event"
      @update:password="sidebarActions.vaultPasswordInput.value = $event"
      @update:remember-mode="sidebarActions.rememberVaultMode.value = $event"
      @save="sidebarActions.handleSaveSecurity"
    />
  </div>
</template>
