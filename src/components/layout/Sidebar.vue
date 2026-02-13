<script setup lang="ts">
import { ref, computed, h } from "vue";
import { useNexusStore } from "../../stores/useNexusStore";
import { useThemeStore } from "../../stores/useThemeStore";
import { cryptoProvider } from "../../services";
import {
  NMenu,
  NButton,
  NIcon,
  NDropdown,
  NInput,
  NModal,
  NSpace,
  NSelect,
  useMessage,
  useDialog,
} from "naive-ui";
import { languageOptions } from "../../constants/languages";

const nexusStore = useNexusStore();
const themeStore = useThemeStore();
const message = useMessage();
const dialog = useDialog();

function releaseActiveFocus() {
  const el = document.activeElement;
  if (el instanceof HTMLElement) {
    el.blur();
  }
}

// 新建分类模态框
const showAddModal = ref(false);
const newCategoryName = ref("");
const newCategoryDefaultLanguage = ref("yaml");
const isAdding = ref(false);

// 右键菜单
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuCategoryId = ref<string | null>(null);

// Security Modal
const showSecurityModal = ref(false);
const vaultPasswordInput = ref("");

// 编辑分类模态框
const showEditModal = ref(false);
const editCategoryName = ref("");
const editCategoryDefaultLanguage = ref("yaml");
const editCategoryId = ref<string | null>(null);

// 图标渲染
const renderIcon = (iconName: string) => {
  const iconMap: Record<string, string> = {
    folder: "i-heroicons-folder",
    router: "i-heroicons-signal",
    smart_toy: "i-heroicons-sparkles",
    code: "i-heroicons-code-bracket",
    document: "i-heroicons-document-text",
  };
  return () =>
    h("div", { class: `${iconMap[iconName] || "i-heroicons-folder"} w-5 h-5` });
};

const menuOptions = computed(() => {
  if (!nexusStore.index) return [];
  return nexusStore.index.categories.map((cat) => ({
    label: cat.name,
    key: cat.id,
    icon: renderIcon(cat.icon || "folder"),
  }));
});

function handleUpdateValue(key: string) {
  nexusStore.selectedCategoryId = key;
  nexusStore.selectedFileId = null;
}

async function handleInitialize() {
  await nexusStore.initializeGist();
}

// 新建分类
async function handleAddCategory() {
  if (!newCategoryName.value.trim()) {
    message.warning("请输入分类名称");
    return;
  }
  isAdding.value = true;
  try {
    await nexusStore.addCategory(
      newCategoryName.value.trim(),
      "folder",
      newCategoryDefaultLanguage.value,
    );
    message.success("分类创建成功");
    newCategoryName.value = "";
    newCategoryDefaultLanguage.value = "yaml";
  } catch (e) {
    message.error("创建失败");
  } finally {
    isAdding.value = false;
    showAddModal.value = false;
  }
}

// 右键菜单
function handleContextMenu(e: MouseEvent, catId: string) {
  e.preventDefault();
  contextMenuCategoryId.value = catId;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
}

function handleClickOutside() {
  showContextMenu.value = false;
}

const contextMenuOptions = [
  { label: "编辑分类", key: "rename" },
  { label: "删除", key: "delete" },
];

async function handleContextMenuSelect(key: string) {
  showContextMenu.value = false;
  const catId = contextMenuCategoryId.value;
  if (!catId) return;

  if (key === "rename") {
    const cat = nexusStore.index?.categories.find((c) => c.id === catId);
    if (cat) {
      editCategoryId.value = catId;
      editCategoryName.value = cat.name;
      editCategoryDefaultLanguage.value = cat.defaultLanguage || "yaml";
      showEditModal.value = true;
    }
  } else if (key === "delete") {
    const cat = nexusStore.index?.categories.find((c) => c.id === catId);
    dialog.warning({
      title: "确认删除",
      content: `确定要删除分类「${cat?.name}」及其所有配置吗？此操作不可撤销。`,
      positiveText: "删除",
      negativeText: "取消",
      onPositiveClick: async () => {
        try {
          await nexusStore.deleteCategory(catId);
          message.success("已删除");
        } catch (e) {
          message.error("删除失败");
        }
      },
    });
  }
}

// 编辑分类
async function handleEditCategory() {
  if (!editCategoryName.value.trim() || !editCategoryId.value) return;
  try {
    await nexusStore.updateCategory(editCategoryId.value, {
      name: editCategoryName.value.trim(),
      defaultLanguage: editCategoryDefaultLanguage.value,
    });
    message.success("已保存");
    showEditModal.value = false;
  } catch (e) {
    message.error("保存失败");
  }
}

// Security
async function handleSaveSecurity() {
  if (!vaultPasswordInput.value) {
    message.warning("密码不能为空");
    return;
  }
  await cryptoProvider.setPassword(vaultPasswordInput.value);
  message.success("保险库密码已设置 (本设备)");
  showSecurityModal.value = false;
  vaultPasswordInput.value = "";

  // 自动重新同步以解密待解密的文件
  if (nexusStore.index) {
    try {
      // 1. 清理本地加密缓存 (删除未修改的明文副本)
      await nexusStore.resetSecureCache();

      // 2. 强制同步 (忽略时间戳，重新拉取并尝试解密)
      await nexusStore.sync(true);

      message.success("缓存已刷新，文件已重新验证");
    } catch (e) {
      console.error("Auto sync after password set failed", e);
    }
  }
}

// 同步
const isSyncing = ref(false);
async function handleSync() {
  isSyncing.value = true;
  try {
    await nexusStore.sync();
    message.success("同步完成");
  } catch (e) {
    message.error("同步失败");
  } finally {
    isSyncing.value = false;
  }
}

const isRepairing = ref(false);

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

function handleRepairShards() {
  if (!nexusStore.index || !nexusStore.currentGistId) {
    message.warning("当前没有可修复的分片数据");
    return;
  }

  releaseActiveFocus();
  dialog.warning({
    title: "修复并清理旧存储",
    content:
      "将执行分片去重、统计重算、README/描述重写，并删除未被当前项目引用的旧 shard gist。继续吗？",
    positiveText: "开始修复",
    negativeText: "取消",
    onPositiveClick: async () => {
      isRepairing.value = true;
      try {
        const result = await nexusStore.repairShards({
          apply: true,
          rewriteReadme: true,
          rewriteDescription: true,
          dropEmptyShards: true,
          deleteOrphanGists: true,
          sweepUnreferencedShardGists: true,
          legacyGistIdToDelete: nexusStore.config?.legacyGistId || null,
        });

        message.success("分片修复完成");
        // Wait one tick after warning dialog closes to avoid focus/aria-hidden contention.
        setTimeout(() => {
          releaseActiveFocus();
          dialog.info({
            title: "修复结果",
            content: formatRepairSummary(result),
          });
        }, 0);
      } catch (e) {
        console.error("Repair shards failed", e);
        message.error("分片修复失败");
      } finally {
        isRepairing.value = false;
      }
    },
  });
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div
      class="p-4 flex items-center space-x-2 border-b transition-colors duration-200"
      :class="themeStore.isDark ? 'border-slate-700' : 'border-slate-200'"
    >
      <div class="i-heroicons-cube-transparent w-6 h-6 text-blue-500"></div>
      <span
        class="font-bold text-lg tracking-wide"
        :class="themeStore.isDark ? 'text-white' : 'text-slate-800'"
        >NEXUS</span
      >
    </div>

    <div class="flex-1 overflow-y-auto py-2">
      <div
        v-if="!nexusStore.index && !nexusStore.isLoading"
        class="p-4 text-center"
      >
        <p class="text-sm text-slate-400 mb-4">未找到配置</p>
        <NButton type="primary" size="small" @click="handleInitialize">
          初始化仓库
        </NButton>
      </div>

      <template v-else>
        <!-- 自定义菜单以支持右键 -->
        <div
          v-for="cat in nexusStore.index?.categories"
          :key="cat.id"
          class="px-2 py-1"
        >
          <div
            class="flex items-center px-3 py-2 rounded-md cursor-pointer transition-all duration-200"
            :class="[
              nexusStore.selectedCategoryId === cat.id
                ? 'bg-blue-500/20 text-blue-500'
                : themeStore.isDark
                  ? 'hover:bg-slate-800 text-slate-300'
                  : 'hover:bg-slate-100 text-slate-600',
            ]"
            @click="handleUpdateValue(cat.id)"
            @contextmenu="handleContextMenu($event, cat.id)"
          >
            <component :is="renderIcon(cat.icon || 'folder')" />
            <span class="ml-3 truncate">{{ cat.name }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- 底部工具栏 -->
    <div
      class="p-3 border-t space-y-2 transition-colors duration-200"
      :class="themeStore.isDark ? 'border-slate-700' : 'border-slate-200'"
    >
      <NButton
        block
        size="small"
        type="primary"
        ghost
        @click="showAddModal = true"
        :disabled="!nexusStore.index"
      >
        <template #icon>
          <div class="i-heroicons-plus w-4 h-4"></div>
        </template>
        新建分类
      </NButton>

      <div class="flex gap-2">
        <NButton
          block
          size="small"
          :quaternary="themeStore.isDark"
          :tertiary="!themeStore.isDark"
          @click="showSecurityModal = true"
        >
          <template #icon>
            <div class="i-heroicons-shield-check w-4 h-4"></div>
          </template>
          设置密码
        </NButton>
      </div>

      <NButton
        block
        size="small"
        :quaternary="themeStore.isDark"
        :tertiary="!themeStore.isDark"
        :loading="isRepairing"
        :disabled="!nexusStore.index"
        @click="handleRepairShards"
      >
        <template #icon>
          <div class="i-heroicons-wrench-screwdriver w-4 h-4"></div>
        </template>
        修复分片
      </NButton>

      <div
        class="flex items-center justify-between text-xs"
        :class="themeStore.isDark ? 'text-slate-500' : 'text-slate-400'"
      >
        <span>{{
          nexusStore.isLoading || isSyncing || isRepairing ? "同步中..." : "已同步"
        }}</span>
        <NButton text size="tiny" :loading="isSyncing" @click="handleSync">
          <template #icon>
            <div class="i-heroicons-arrow-path w-4 h-4"></div>
          </template>
        </NButton>
      </div>

      <!-- API Rate Limit -->
      <div
        v-if="nexusStore.apiRateLimit?.limit > 0"
        class="flex items-center justify-between text-xs pt-1 border-t border-dashed"
        :class="[
          themeStore.isDark
            ? 'text-slate-500 border-slate-700'
            : 'text-slate-400 border-slate-200',
          nexusStore.apiRateLimit.remaining < 100
            ? 'text-red-500 font-bold'
            : '',
        ]"
        :title="`重置时间: ${new Date(nexusStore.apiRateLimit.resetAt).toLocaleTimeString()}`"
      >
        <span>API 配额</span>
        <span
          >{{ nexusStore.apiRateLimit.remaining }}/{{
            nexusStore.apiRateLimit.limit
          }}</span
        >
      </div>
    </div>

    <!-- 右键菜单 -->
    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="contextMenuX"
      :y="contextMenuY"
      :options="contextMenuOptions"
      :show="showContextMenu"
      @select="handleContextMenuSelect"
      @clickoutside="handleClickOutside"
    />

    <!-- 新建分类模态框 -->
    <NModal v-model:show="showAddModal" preset="dialog" title="新建分类">
      <div class="space-y-4">
        <NInput
          v-model:value="newCategoryName"
          placeholder="输入分类名称"
          @keydown.enter="handleAddCategory"
        />
        <NSelect
          v-model:value="newCategoryDefaultLanguage"
          :options="languageOptions"
          placeholder="选择默认语言"
        />
      </div>
      <template #action>
        <NSpace>
          <NButton @click="showAddModal = false">取消</NButton>
          <NButton type="primary" :loading="isAdding" @click="handleAddCategory"
            >创建</NButton
          >
        </NSpace>
      </template>
    </NModal>

    <!-- 编辑分类模态框 -->
    <NModal v-model:show="showEditModal" preset="dialog" title="编辑分类">
      <div class="space-y-4">
        <NInput
          v-model:value="editCategoryName"
          placeholder="输入分类名称"
          @keydown.enter="handleEditCategory"
        />
        <NSelect
          v-model:value="editCategoryDefaultLanguage"
          :options="languageOptions"
          placeholder="选择默认语言"
        />
      </div>
      <template #action>
        <NSpace>
          <NButton @click="showEditModal = false">取消</NButton>
          <NButton type="primary" @click="handleEditCategory">保存</NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 安全设置模态框 -->
    <NModal
      v-model:show="showSecurityModal"
      preset="dialog"
      title="设置保险库密码"
    >
      <div class="space-y-4">
        <p class="text-xs text-gray-500">
          此密码用于加密/解密标记为“安全”的文件。密码仅存储在本地
          (LocalStorage)。
        </p>
        <NInput
          v-model:value="vaultPasswordInput"
          type="password"
          placeholder="输入新的保险库密码"
          show-password-on="click"
          @keydown.enter="handleSaveSecurity"
        />
      </div>
      <template #action>
        <NSpace>
          <NButton @click="showSecurityModal = false">取消</NButton>
          <NButton type="primary" @click="handleSaveSecurity">保存</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
