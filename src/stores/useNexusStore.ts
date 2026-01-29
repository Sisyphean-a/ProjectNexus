import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { localStoreRepository } from "../infrastructure";
// Ideally read via Service or Repo. fileService doesn't expose getFile.
// Let's keep nexusDb for now for reading content, or import fileRepository.
import {
  fileRepository,
  gistRepository,
  localHistoryRepository,
} from "../infrastructure";
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
    if (
      !index.value ||
      !Array.isArray(index.value.categories) ||
      !selectedCategoryId.value
    )
      return null;
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

  async function sync(force = false) {
    if (!authStore.isAuthenticated) {
      throw new Error("未认证");
    }
    isLoading.value = true;

    try {
      if (!config.value) {
        config.value = await localStoreRepository.getConfig();
      }

      // 如果强制同步，传入 null 作为上次更新时间以忽略增量检查
      const result = await syncService.syncDown(
        config.value!,
        force ? null : remoteUpdatedAt.value,
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

    // Capture history snapshot
    try {
      await localHistoryRepository.addSnapshot(fileId, content, "manual");
      await localHistoryRepository.pruneHistory(fileId);
    } catch (e) {
      console.warn("[Nexus History] Failed to save snapshot", e);
    }
  }

  async function restoreFileContent(fileId: string, content: string) {
    if (!index.value || !config.value) return;

    // 恢复等同于一次保存，但我们可以标记为 'restore' 类型
    // 这里直接利用 saveFileContent 逻辑，但也许我们想明确历史记录类型？
    // 还是直接复用？
    // 调用 fileService 更新内容
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

    // 记录恢复操作的历史
    try {
      await localHistoryRepository.addSnapshot(
        fileId,
        content,
        "restore",
        "Restored from history",
      );
    } catch (e) {
      console.warn("[Nexus History] Failed to save restore snapshot", e);
    }
  }

  // 导入远程历史到本地
  async function importRemoteHistory(fileId: string, filename: string) {
    if (!currentGistId.value) return;

    // 1. 获取远程 Commit 列表
    const history = await gistRepository.getGistHistory(currentGistId.value);

    // 2. 遍历并导入 (倒序遍历，虽然 addSnapshot 并不严格依赖顺序，但便于逻辑理解)
    // 注意：Gist API 只有 listCommits，需要逐个获取详情才能拿到文件内容
    // 为了性能，我们限制只获取最近 10 个版本
    const recentHistory = history.slice(0, 10);

    let importedCount = 0;

    for (const entry of recentHistory) {
      try {
        // 检查本地是否已存在该时间点的记录（简单通过 timestamp 检查不太准，这里依靠 addSnapshot 的内容去重）
        // 更理想的是：LocalHistoryRepository 支持按 timestamp 查询
        // 但这里直接由 addSnapshot 处理

        // 获取该版本的文件内容
        const files = await gistRepository.getGistVersion(
          currentGistId.value,
          entry.version,
        );
        const targetFile = files[filename];

        if (targetFile) {
          await localHistoryRepository.addSnapshot(
            fileId,
            targetFile.content,
            "sync",
            `Imported from Gist (${entry.version.substring(0, 7)})`,
            entry.committedAt, // 使用 commits 中的提交时间
          );
          importedCount++;
        }
      } catch (e) {
        console.warn(
          `[History Import] Failed to import version ${entry.version}`,
          e,
        );
      }
    }

    return importedCount;
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

  // 清理本地未修改的加密文件缓存 (用于密码变更时重置状态)
  async function resetSecureCache() {
    if (!index.value) return;

    const secureFilesToDelete: string[] = [];

    // 1. 收集所有 isSecure 的文件 ID
    for (const cat of index.value.categories) {
      for (const item of cat.items) {
        if (item.isSecure) {
          secureFilesToDelete.push(item.id);
        }
      }
    }

    // 2. 检查 dirty 状态并删除
    // 我们必须逐个检查，因为不能删除 dirty 的文件（防止数据丢失）
    await Promise.all(
      secureFilesToDelete.map(async (id) => {
        try {
          const file = await fileRepository.get(id);
          if (file && !file.isDirty) {
            await fileRepository.delete(id);
          }
        } catch (e) {
          console.warn(`[Nexus] Failed to clear secure cache for ${id}`, e);
        }
      }),
    );

    console.log(
      `[Nexus] Secure cache reset. Cleared ${secureFilesToDelete.length} potential targets.`,
    );
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

  async function addCategory(
    name: string,
    icon = "folder",
    defaultLanguage = "yaml",
  ) {
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
      if (updates.defaultLanguage !== undefined)
        cat.defaultLanguage = updates.defaultLanguage;
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
    const category = index.value.categories.find((c) => c.id === categoryId);
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
    // History
    getFileHistory: async (fileId: string) =>
      localHistoryRepository.getHistory(fileId),
    restoreFileContent,
    importRemoteHistory,
    resetSecureCache,
    updateFileSecureStatus: async (fileId: string, isSecure: boolean) => {
      if (!index.value || !config.value) return;

      // 1. Update Index Entry
      let itemFound = false;
      for (const cat of index.value.categories) {
        const item = cat.items.find((i) => i.id === fileId);
        if (item) {
          item.isSecure = isSecure;
          itemFound = true;
          break;
        }
      }
      if (!itemFound) return;

      // 2. Update Local Entity
      const file = await fileRepository.get(fileId);
      if (file) {
        file.isSecure = isSecure;
        // Ensure we mark it as dirty if we want to force push?
        // Actually saveFileContent treats content update.
        // SyncService.pushFile encrypts based on isSecure.
        // We just need to trigger a push.
        await fileRepository.save(file);
      } else {
        return;
      }

      // 3. Save Index (Metadata)
      // This pushes the updated index with isSecure flag
      try {
        await saveIndex();
      } catch (e: any) {
        // Auto-fixing conflict
        if (e.message && e.message.includes("同步冲突")) {
          console.warn(
            "[Nexus] Caught sync conflict during secure toggle, attempting auto-sync and retry...",
          );

          // 1. Pull latest
          await sync();

          // 2. Re-check item existence (it might have been deleted remotely)
          // Need to fetch fresh index value
          if (!index.value) throw new Error("同步后索引丢失");

          let reCheckItem = null;
          for (const cat of index.value.categories) {
            const found = cat.items.find((i) => i.id === fileId);
            if (found) {
              reCheckItem = found;
              break;
            }
          }

          if (!reCheckItem) {
            throw new Error("文件在远程已被删除，无法继续操作");
          }

          // 3. Re-apply status
          reCheckItem.isSecure = isSecure;

          const reFetchedFile = await fileRepository.get(fileId);
          if (reFetchedFile) {
            reFetchedFile.isSecure = isSecure;
            await fileRepository.save(reFetchedFile);
          }

          // 4. Retry Save Index
          await saveIndex();
        } else {
          throw e;
        }
      }

      // 4. Trigger Push for File (Content)
      // We reuse saveFileContent which calls fileService.updateContent -> pushFile
      // The content itself hasn't changed in memory (plain text), but on push it will be encrypted/decrypted.
      await saveFileContent(fileId, file.content);
    },
  };
});
