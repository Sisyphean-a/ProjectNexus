import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { localStoreRepository } from "../infrastructure";
// Ideally read via Service or Repo. fileService doesn't expose getFile.
// Let's keep nexusDb for now for reading content, or import fileRepository.
import { fileRepository, gistRepository } from "../infrastructure";
import { syncService, fileService } from "../services";
import type { NexusIndex, NexusConfig } from "../core/domain/entities/types";
import { useAuthStore } from "./useAuthStore";

export const useNexusStore = defineStore("nexus", () => {
  const authStore = useAuthStore();

  const config = ref<NexusConfig | null>(null);
  const index = ref<NexusIndex | null>(null);
  const isLoading = ref(false);

  // 同步状态追踪
  const lastSyncedAt = ref<string | null>(null); // 上次成功同步的时间
  const remoteUpdatedAt = ref<string | null>(null); // 远程索引的 updated_at

  // Current Gist ID being used
  const currentGistId = computed(() => config.value?.gistId);

  // Selection State
  const selectedCategoryId = ref<string | null>(null);
  const selectedFileId = ref<string | null>(null);

  // API 限制信息 (直接从基础设施层响应)
  const apiRateLimit = computed(() => gistRepository.rateLimit);

  const currentCategory = computed(() => {
    if (!index.value || !Array.isArray(index.value.categories) || !selectedCategoryId.value) return null;
    return (
      index.value.categories.find((c) => c.id === selectedCategoryId.value) ||
      null
    );
  });

  // List of files in current category
  const currentFileList = computed(() => {
    return currentCategory.value?.items || [];
  });

  async function init() {
    config.value = await localStoreRepository.getConfig();

    // Attempt to load local index
    const localIndex = await localStoreRepository.getIndex();
    // Validate integrity
    if (localIndex && Array.isArray(localIndex.categories)) {
      index.value = localIndex;
    } else {
      if (localIndex) {
        console.warn(
          "[Nexus Store] Found local index but it seems corrupted (missing categories). Ignored.",
        );
      }
      index.value = null;
    }
  }

  async function sync() {
    if (!authStore.isAuthenticated) {
      throw new Error("未认证");
    }
    isLoading.value = true;

    try {
      if (!config.value) {
        config.value = await localStoreRepository.getConfig();
      }

      const result = await syncService.syncDown(
        config.value!,
        remoteUpdatedAt.value,
      );

      if (result.synced) {
        if (result.index) {
          index.value = result.index;
        }

        // 优先使用 Gist 的 updated_at，如果未提供（本地已最新且无返回），则保持原样或使用 Index 内部时间
        // 但注意：syncDown 返回的 gistUpdatedAt 是 Gist 的 container updated_at。
        if (result.gistUpdatedAt) {
          remoteUpdatedAt.value = result.gistUpdatedAt;
        } else if (result.index?.updated_at) {
          // Fallback，但这可能就是问题所在，所以仅当 gistUpdatedAt 确实不存在时使用
          remoteUpdatedAt.value = result.index.updated_at;
        }

        lastSyncedAt.value = new Date().toISOString();

        if (result.configUpdates) {
          await updateConfig(result.configUpdates);
        }

        if (
          !selectedCategoryId.value &&
          index.value?.categories.length &&
          index.value.categories.length > 0
        ) {
          selectedCategoryId.value = index.value.categories[0].id;
        }

        console.log("[Nexus Sync] 同步完成");
      } else {
        console.log("[Nexus Sync] 本地已是最新");
      }
    } catch (e: any) {
      console.error("[Nexus] 同步失败:", e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  // ========== Content Actions ==========
  async function getFileContent(fileId: string): Promise<string> {
    const file = await fileRepository.get(fileId);
    return file ? file.content : "";
  }

  async function saveFileContent(fileId: string, content: string) {
    if (!index.value || !config.value) return;

    const ctx = {
      index: index.value,
      config: config.value,
      lastRemoteUpdatedAt: remoteUpdatedAt.value,
    };

    const { newRemoteTime } = await fileService.updateContent(
      ctx,
      fileId,
      content,
    );

    if (newRemoteTime) {
      remoteUpdatedAt.value = newRemoteTime;
      lastSyncedAt.value = new Date().toISOString();
    }
  }

  async function initializeGist() {
    if (!authStore.isAuthenticated) return;
    isLoading.value = true;
    try {
      const initialIndex: NexusIndex = {
        updated_at: new Date().toISOString(),
        categories: [
          {
            id: "default",
            name: "General",
            icon: "folder",
            defaultLanguage: "yaml",
            items: [],
          },
        ],
      };

      // Use SyncService to create Gist
      const gistId = await syncService.initializeNexus(initialIndex);
      await updateConfig({ gistId });

      index.value = initialIndex;
      // No need to saveIndex again locally as initializeNexus (Service) usually handles it via Repo?
      // SyncService.initializeNexus does `localStore.saveIndex`. So we are good.

      selectedCategoryId.value = "default";
    } catch (e) {
      console.error("Failed to initialize Nexus Gist", e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateConfig(updates: Partial<NexusConfig>) {
    await localStoreRepository.saveConfig(updates);
    config.value = { ...config.value!, ...updates };
  }

  // ========== 索引保存 ==========
  async function saveIndex(forceOverwrite = false) {
    if (!index.value || !currentGistId.value) {
      const errorMsg = "[Nexus Save] 无法保存：index 或 gistId 为空";
      console.warn(errorMsg);
      throw new Error(errorMsg); // ✅ 抛出异常而不是静默返回
    }

    // 空数据保护：如果本地索引完全为空，阻止推送
    if (index.value.categories.length === 0 && !forceOverwrite) {
      console.warn(
        "[Nexus Save] ⚠️ 本地索引为空，已阻止推送（可能会覆盖远程数据）",
      );
      throw new Error(
        "本地索引为空，拒绝推送以防止数据丢失。如需清空远程，请使用强制覆盖。",
      );
    }

    try {
      const newTime = await syncService.pushIndex(
        currentGistId.value,
        index.value,
        remoteUpdatedAt.value,
        forceOverwrite,
      );

      remoteUpdatedAt.value = newTime;
      lastSyncedAt.value = new Date().toISOString();
      console.log("[Nexus Save] ✅ 保存成功");
    } catch (e: any) {
      if (e.message?.includes("同步冲突")) {
        throw e;
      }
      console.warn("[Nexus Save] 保存失败:", e);
      throw e;
    }
  }

  // ========== 分类 CRUD ==========

  async function addCategory(name: string, icon = "folder", defaultLanguage = "yaml") {
    console.log("[addCategory] 开始创建分类:", name);

    if (!index.value) {
      console.error("[addCategory] index.value 为空");
      return;
    }

    console.log("[addCategory] currentGistId:", currentGistId.value);
    console.log(
      "[addCategory] index.value.categories.length:",
      index.value.categories.length,
    );

    // Use IdGenerator or simple random string if acceptable?
    // Let's us IdGenerator from shared kernel.
    // Wait, I need to import it. I'll add import in another step or just use simple logic here if I don't want to mess up imports block again?
    // To follow the plan strictly, I should have imported it.
    // But I can inline generation for now to save tool calls, as it was a private helper before.
    // Or I can add import at top.
    // I'll inline a simple generator to be safe and clean.
    const genId = () =>
      Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    const newCategory = {
      id: genId(),
      name,
      icon,
      defaultLanguage,
      items: [],
    };

    console.log("[addCategory] 新分类对象:", newCategory);

    // 先添加到本地索引
    index.value.categories.push(newCategory);
    console.log(
      "[addCategory] 已添加到本地索引,当前分类数:",
      index.value.categories.length,
    );

    try {
      // 尝试保存到远程
      console.log("[addCategory] 准备调用 saveIndex...");
      await saveIndex();
      console.log("[addCategory] saveIndex 成功");
      selectedCategoryId.value = newCategory.id;
      return newCategory;
    } catch (e) {
      console.error("[addCategory] saveIndex 失败:", e);
      // 如果远程保存失败,回滚本地更改
      const idx = index.value.categories.findIndex(
        (c) => c.id === newCategory.id,
      );
      if (idx !== -1) {
        index.value.categories.splice(idx, 1);
        console.log("[addCategory] 已回滚本地更改");
      }
      throw e; // 重新抛出异常,让调用者知道失败了
    }
  }

  async function updateCategory(
    id: string,
    updates: { name?: string; icon?: string; defaultLanguage?: string },
  ) {
    if (!index.value) return;
    const cat = index.value.categories.find((c) => c.id === id);
    if (cat) {
      if (updates.name) cat.name = updates.name;
      if (updates.icon) cat.icon = updates.icon;
      if (updates.defaultLanguage !== undefined) cat.defaultLanguage = updates.defaultLanguage;
      await saveIndex();
    }
  }

  async function deleteCategory(id: string) {
    if (!index.value || !currentGistId.value) return;
    const catIndex = index.value.categories.findIndex((c) => c.id === id);
    if (catIndex === -1) return;

    // 先保存分类引用
    const category = index.value.categories[catIndex];

    // 1. 先更新本地索引并保存
    index.value.categories.splice(catIndex, 1);

    // 如果没有任何分类了，允许强制保存以清空远程
    const isNowEmpty = index.value.categories.length === 0;
    await saveIndex(isNowEmpty);

    // 2. 异步清理孤儿文件
    const gistId = currentGistId.value;
    Promise.all(
      category.items.map(async (item) => {
        try {
          // 删除本地 DB
          await fileRepository.delete(item.id);

          // 删除远程文件
          await syncService.deleteRemoteFile(gistId, item.gist_file);
        } catch (e) {
          console.warn(`[Nexus] Failed to cleanup file ${item.gist_file}`, e);
        }
      }),
    ).then(() => {
      console.log("[Nexus] Cleanup completed");
    });

    // 重置选择
    if (selectedCategoryId.value === id) {
      selectedCategoryId.value = index.value.categories[0]?.id || null;
      selectedFileId.value = null;
    }
  }

  // ========== 文件 CRUD ==========

  async function addFile(
    categoryId: string,
    title: string,
    language?: string,
    initialContent = "",
  ) {
    if (!index.value || !currentGistId.value || !config.value) return null;

    // 获取分类默认语言
    const category = index.value.categories.find(c => c.id === categoryId);
    const finalLanguage = language || category?.defaultLanguage || "yaml";

    const ctx = {
      index: index.value,
      config: config.value,
      lastRemoteUpdatedAt: remoteUpdatedAt.value,
    };

    const { file, newRemoteTime } = await fileService.createFile(
      ctx,
      categoryId,
      title,
      finalLanguage,
      initialContent,
    );

    if (newRemoteTime) {
      remoteUpdatedAt.value = newRemoteTime;
      lastSyncedAt.value = new Date().toISOString();
    }

    selectedFileId.value = file.id;

    return {
      id: file.id,
      title: file.title,
      gist_file: file.filename,
      language: file.language,
      tags: file.tags,
    };
  }

  async function changeFileLanguage(
    fileId: string,
    newLanguage: string,
  ): Promise<boolean> {
    if (!index.value || !config.value) return false;

    const ctx = {
      index: index.value,
      config: config.value,
      lastRemoteUpdatedAt: remoteUpdatedAt.value,
    };

    const { success, newRemoteTime } = await fileService.changeLanguage(
      ctx,
      fileId,
      newLanguage,
    );

    if (success && newRemoteTime) {
      remoteUpdatedAt.value = newRemoteTime;
      lastSyncedAt.value = new Date().toISOString();
    }

    return success;
  }

  async function getFileLanguage(fileId: string): Promise<string> {
    const file = await fileRepository.get(fileId);
    return file?.language || "yaml";
  }

  async function updateFile(
    fileId: string,
    updates: { title?: string; tags?: string[] },
  ) {
    if (!index.value || !config.value) return;

    const ctx = {
      index: index.value,
      config: config.value,
      lastRemoteUpdatedAt: remoteUpdatedAt.value,
    };

    const { newRemoteTime } = await fileService.updateFileMetadata(
      ctx,
      fileId,
      updates,
    );

    if (newRemoteTime) {
      remoteUpdatedAt.value = newRemoteTime;
      lastSyncedAt.value = new Date().toISOString();
    }
  }

  async function deleteFile(categoryId: string, fileId: string) {
    if (!index.value || !config.value) return;

    const ctx = {
      index: index.value,
      config: config.value,
      lastRemoteUpdatedAt: remoteUpdatedAt.value,
    };

    const { newRemoteTime } = await fileService.deleteFile(
      ctx,
      categoryId,
      fileId,
    );

    if (newRemoteTime) {
      remoteUpdatedAt.value = newRemoteTime;
      lastSyncedAt.value = new Date().toISOString();
    }

    if (selectedFileId.value === fileId) {
      selectedFileId.value = null;
    }
  }

  return {
    config,
    index,
    isLoading,
    currentGistId,
    selectedCategoryId,
    selectedFileId,
    currentCategory,
    currentFileList,
    lastSyncedAt,
    remoteUpdatedAt,
    apiRateLimit,
    init,
    sync,
    initializeGist,
    updateConfig,
    saveIndex,
    addCategory,
    updateCategory,
    deleteCategory,
    addFile,
    updateFile,
    deleteFile,
    getFileContent,
    saveFileContent,
    changeFileLanguage,
    getFileLanguage,
  };
});
