<script setup lang="ts">
import { ref, computed, h } from "vue";
import { useNexusStore } from "../../stores/useNexusStore";
import { useThemeStore } from "../../stores/useThemeStore";
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

const nexusStore = useNexusStore();
const themeStore = useThemeStore();
const message = useMessage();
const dialog = useDialog();

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

// 语言选项
const languageOptions = [
  { label: "YAML", value: "yaml" },
  { label: "JSON", value: "json" },
  { label: "Markdown", value: "markdown" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "HTML", value: "html" },
  { label: "CSS", value: "css" },
  { label: "Shell", value: "shell" },
  { label: "XML", value: "xml" },
  { label: "纯文本", value: "plaintext" },
];

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
      newCategoryDefaultLanguage.value
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

      <div
        class="flex items-center justify-between text-xs"
        :class="themeStore.isDark ? 'text-slate-500' : 'text-slate-400'"
      >
        <span>{{
          nexusStore.isLoading || isSyncing ? "同步中..." : "已同步"
        }}</span>
        <NButton text size="tiny" :loading="isSyncing" @click="handleSync">
          <template #icon>
            <div class="i-heroicons-arrow-path w-4 h-4"></div>
          </template>
        </NButton>
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
  </div>
</template>
