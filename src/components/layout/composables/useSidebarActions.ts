import { computed, ref, watch } from "vue";

const REMEMBER_VAULT_PREF_KEY = "nexus_vault_remember_mode";
const DEFAULT_REMEMBER_MODE = "session";

type RememberVaultMode = "memory" | "session" | "trustedDevice";
type LoadingHandle = { destroy: () => void };
type MessageLike = {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  loading: (message: string, options?: { duration: number }) => LoadingHandle;
};
type DialogLike = {
  warning: (options: {
    title: string;
    content: string;
    positiveText: string;
    negativeText?: string;
    onPositiveClick?: () => void;
  }) => void;
  info: (options: { title: string; content: string }) => void;
};

type WorkspaceStoreLike = {
  index: {
    categories: Array<{
      id: string;
      name: string;
      defaultLanguage?: string;
    }>;
  } | null;
  isLoading: boolean;
  config?: { legacyGistId?: string | null } | null;
  currentGistId?: string | null;
  initializeGist?: () => Promise<void>;
  addCategory?: (name: string, icon: string, defaultLanguage: string) => Promise<void>;
  updateCategory?: (
    categoryId: string,
    payload: { name: string; defaultLanguage: string },
  ) => Promise<void>;
  deleteCategory?: (categoryId: string) => Promise<{ failedFiles: string[] }>;
};

type SelectionStoreLike = {
  selectCategory: (categoryId: string) => void;
  selectFile: (fileId: string | null) => void;
  selectedCategoryId?: string | null;
};

type SyncStoreLike = {
  apiRateLimit: { limit: number; remaining: number; resetAt: string } | null;
  sync?: (force?: boolean) => Promise<void>;
  forcePullFromRemote?: () => Promise<void>;
  repairShards?: (options: Record<string, unknown>) => Promise<{
    rawShardCount: number;
    dedupedShardCount: number;
    duplicateRowsMerged: number;
    manifestsLoaded: number;
    repairedShardCount: number;
    removedEmptyShards: number;
    sweptUnreferencedShardGists: number;
    deletedLegacyGistId?: string;
  }>;
};

type VaultStoreLike = {
  setPassword?: (
    password: string,
    options: { rememberMode: RememberVaultMode },
  ) => Promise<void>;
  resetSecureCache?: () => Promise<void>;
};

export interface UseSidebarActionsOptions {
  workspaceStore: WorkspaceStoreLike;
  selectionStore: SelectionStoreLike;
  syncStore: SyncStoreLike;
  vaultStore: VaultStoreLike;
  message: MessageLike;
  dialog: DialogLike;
}

function readRememberVaultPreference(): RememberVaultMode {
  try {
    const raw = window.localStorage.getItem(REMEMBER_VAULT_PREF_KEY);
    if (raw === "memory" || raw === "session" || raw === "trustedDevice") {
      return raw;
    }
  } catch {
    // localStorage may be unavailable in tests or restricted contexts.
  }
  return DEFAULT_REMEMBER_MODE;
}

function persistRememberVaultPreference(mode: RememberVaultMode) {
  try {
    window.localStorage.setItem(REMEMBER_VAULT_PREF_KEY, mode);
  } catch {
    // localStorage may be unavailable in tests or restricted contexts.
  }
}

function formatRepairSummary(result: {
  rawShardCount: number;
  dedupedShardCount: number;
  duplicateRowsMerged: number;
  manifestsLoaded: number;
  repairedShardCount: number;
  removedEmptyShards: number;
  sweptUnreferencedShardGists: number;
  deletedLegacyGistId?: string;
}) {
  const lines = [
    `原始分片数: ${result.rawShardCount}`,
    `去重后分片数: ${result.dedupedShardCount}`,
    `合并重复行: ${result.duplicateRowsMerged}`,
    `读取 manifest 数: ${result.manifestsLoaded}`,
    `修复后分片数: ${result.repairedShardCount}`,
    `移除空分片: ${result.removedEmptyShards}`,
    `清理旧分片 gist: ${result.sweptUnreferencedShardGists}`,
  ];

  if (result.deletedLegacyGistId) {
    lines.push(`已删除 legacy gist: ${result.deletedLegacyGistId}`);
  }

  return lines.join("\n");
}

function releaseActiveFocus() {
  const element = document.activeElement;
  if (element instanceof HTMLElement) {
    element.blur();
  }
}

export function useSidebarActions(options: UseSidebarActionsOptions) {
  const {
    workspaceStore,
    selectionStore,
    syncStore,
    vaultStore,
    message,
    dialog,
  } = options;

  const showAddModal = ref(false);
  const showSecurityModal = ref(false);
  const showEditModal = ref(false);
  const showContextMenu = ref(false);
  const newCategoryName = ref("");
  const newCategoryDefaultLanguage = ref("yaml");
  const editCategoryName = ref("");
  const editCategoryDefaultLanguage = ref("yaml");
  const editCategoryId = ref<string | null>(null);
  const contextMenuCategoryId = ref<string | null>(null);
  const contextMenuX = ref(0);
  const contextMenuY = ref(0);
  const vaultPasswordInput = ref("");
  const isAdding = ref(false);
  const isSyncing = ref(false);
  const isForcePulling = ref(false);
  const isRepairing = ref(false);
  const rememberVaultMode = ref<RememberVaultMode>(readRememberVaultPreference());

  const rememberModeOptions = [
    { label: "仅内存（最安全）", value: "memory" },
    { label: "会话内记住", value: "session" },
    { label: "受信任设备（30 天）", value: "trustedDevice" },
  ];

  const contextMenuOptions = [
    { label: "编辑分类", key: "rename" },
    { label: "删除", key: "delete" },
  ];

  const isSyncBusy = computed(
    () => workspaceStore.isLoading || isSyncing.value || isRepairing.value || isForcePulling.value,
  );

  watch(rememberVaultMode, (mode) => {
    persistRememberVaultPreference(mode);
  });

  function selectCategory(categoryId: string) {
    selectionStore.selectCategory(categoryId);
    selectionStore.selectFile(null);
  }

  async function handleInitialize() {
    await workspaceStore.initializeGist?.();
  }

  async function handleAddCategory() {
    if (!newCategoryName.value.trim()) {
      message.warning("请输入分类名称");
      return;
    }

    isAdding.value = true;
    try {
      await workspaceStore.addCategory?.(
        newCategoryName.value.trim(),
        "folder",
        newCategoryDefaultLanguage.value,
      );
      message.success("分类创建成功");
      newCategoryName.value = "";
      newCategoryDefaultLanguage.value = "yaml";
      showAddModal.value = false;
    } catch {
      message.error("创建失败");
    } finally {
      isAdding.value = false;
    }
  }

  function openContextMenu(event: MouseEvent, categoryId: string) {
    event.preventDefault();
    contextMenuCategoryId.value = categoryId;
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    showContextMenu.value = true;
  }

  function closeContextMenu() {
    showContextMenu.value = false;
  }

  function beginEditCategory(categoryId: string) {
    const category = workspaceStore.index?.categories.find((item) => item.id === categoryId);
    if (!category) {
      return;
    }

    editCategoryId.value = categoryId;
    editCategoryName.value = category.name;
    editCategoryDefaultLanguage.value = category.defaultLanguage || "yaml";
    showEditModal.value = true;
  }

  function confirmDeleteCategory(categoryId: string) {
    const category = workspaceStore.index?.categories.find((item) => item.id === categoryId);
    dialog.warning({
      title: "确认删除",
      content: `确定要删除分类「${category?.name}」及其所有配置吗？此操作不可撤销。`,
      positiveText: "删除",
      negativeText: "取消",
      onPositiveClick: () => {
        const deletingMessage = message.loading("删除分类中...", { duration: 0 });
        void (async () => {
          try {
            const result = await workspaceStore.deleteCategory?.(categoryId);
            if (result && result.failedFiles.length > 0) {
              message.warning(`分类已删除，但有 ${result.failedFiles.length} 个文件清理失败`);
            } else {
              message.success("已删除");
            }
          } catch {
            message.error("删除失败");
          } finally {
            deletingMessage.destroy();
          }
        })();
      },
    });
  }

  function handleContextMenuSelect(key: string) {
    closeContextMenu();
    if (!contextMenuCategoryId.value) {
      return;
    }

    if (key === "rename") {
      beginEditCategory(contextMenuCategoryId.value);
      return;
    }

    confirmDeleteCategory(contextMenuCategoryId.value);
  }

  async function handleEditCategory() {
    if (!editCategoryName.value.trim() || !editCategoryId.value) {
      return;
    }

    try {
      await workspaceStore.updateCategory?.(editCategoryId.value, {
        name: editCategoryName.value.trim(),
        defaultLanguage: editCategoryDefaultLanguage.value,
      });
      message.success("已保存");
      showEditModal.value = false;
    } catch {
      message.error("保存失败");
    }
  }

  async function handleSaveSecurity() {
    if (!vaultPasswordInput.value) {
      message.warning("密码不能为空");
      return;
    }

    await vaultStore.setPassword?.(vaultPasswordInput.value, {
      rememberMode: rememberVaultMode.value,
    });
    const modeTip: Record<RememberVaultMode, string> = {
      memory: "仅保留在内存中",
      session: "本次会话内可自动恢复",
      trustedDevice: "此设备 30 天内可自动恢复",
    };
    message.success(`保险库密码已设置（${modeTip[rememberVaultMode.value]}）`);
    showSecurityModal.value = false;
    vaultPasswordInput.value = "";

    if (!workspaceStore.index) {
      return;
    }

    try {
      await vaultStore.resetSecureCache?.();
      await syncStore.sync?.(true);
      message.success("缓存已刷新，文件已重新验证");
    } catch (error) {
      console.error("Auto sync after password set failed", error);
    }
  }

  async function handleSync() {
    isSyncing.value = true;
    try {
      await syncStore.sync?.();
      message.success("同步完成");
    } catch {
      message.error("同步失败");
    } finally {
      isSyncing.value = false;
    }
  }

  function handleForcePull() {
    releaseActiveFocus();
    dialog.warning({
      title: "强制拉取覆盖",
      content: "此操作会删除本地全部文档缓存与历史记录，并以远程版本完整覆盖本地。未同步的本地改动将永久丢失。确认继续吗？",
      positiveText: "删除本地并拉取",
      negativeText: "取消",
      onPositiveClick: () => {
        isForcePulling.value = true;
        const forcingMessage = message.loading("正在强制拉取远程数据...", { duration: 0 });
        void (async () => {
          try {
            await syncStore.forcePullFromRemote?.();
            message.success("强制拉取完成，已采用远程数据");
          } catch (error) {
            console.error("Force pull failed", error);
            const detail = error instanceof Error ? error.message : "未知错误";
            message.error(`强制拉取失败：${detail}`);
          } finally {
            forcingMessage.destroy();
            isForcePulling.value = false;
          }
        })();
      },
    });
  }

  function handleRepairShards() {
    if (!workspaceStore.index || !workspaceStore.currentGistId) {
      message.warning("当前没有可修复的分片数据");
      return;
    }

    releaseActiveFocus();
    dialog.warning({
      title: "修复并清理旧存储",
      content: "将执行分片去重、统计重算、README/描述重写，并删除未被当前项目引用的旧 shard gist。继续吗？",
      positiveText: "开始修复",
      negativeText: "取消",
      onPositiveClick: () => {
        isRepairing.value = true;
        const repairingMessage = message.loading("分片修复中...", { duration: 0 });
        void (async () => {
          try {
            const result = await syncStore.repairShards?.({
              apply: true,
              rewriteReadme: true,
              rewriteDescription: true,
              dropEmptyShards: true,
              deleteOrphanGists: true,
              sweepUnreferencedShardGists: true,
              legacyGistIdToDelete: workspaceStore.config?.legacyGistId || null,
            });
            if (!result) {
              throw new Error("repairShards 没有返回结果");
            }
            message.success("分片修复完成");
            setTimeout(() => {
              releaseActiveFocus();
              dialog.info({
                title: "修复结果",
                content: formatRepairSummary(result),
              });
            }, 0);
          } catch (error) {
            console.error("Repair shards failed", error);
            message.error("分片修复失败");
          } finally {
            repairingMessage.destroy();
            isRepairing.value = false;
          }
        })();
      },
    });
  }

  return {
    showAddModal,
    showSecurityModal,
    showEditModal,
    showContextMenu,
    newCategoryName,
    newCategoryDefaultLanguage,
    editCategoryName,
    editCategoryDefaultLanguage,
    contextMenuCategoryId,
    contextMenuX,
    contextMenuY,
    contextMenuOptions,
    vaultPasswordInput,
    isAdding,
    isSyncing,
    isForcePulling,
    isRepairing,
    isSyncBusy,
    rememberVaultMode,
    rememberModeOptions,
    selectCategory,
    handleInitialize,
    handleAddCategory,
    openContextMenu,
    closeContextMenu,
    handleContextMenuSelect,
    handleEditCategory,
    handleSaveSecurity,
    handleSync,
    handleForcePull,
    handleRepairShards,
  };
}
