<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  NEmpty,
  NInput,
  NButton,
  NDropdown,
  NModal,
  NSpace,
  NSelect,
  useMessage,
  useDialog,
} from "naive-ui";
import Fuse from "fuse.js";
import type { GistIndexItem } from "../../core/domain/entities/types";
import { languageOptions } from "../../constants/languages";
import { useThemeStore } from "../../stores/useThemeStore";
import { useWorkspaceStore } from "../../presentation/stores/useWorkspaceStore";
import { useSelectionStore } from "../../presentation/stores/useSelectionStore";

const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
const themeStore = useThemeStore();
const message = useMessage();
const dialog = useDialog();

const searchQuery = ref("");
const showAddModal = ref(false);
const newFileName = ref("");
const newFileLanguage = ref("yaml");
const isAdding = ref(false);
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuFileId = ref<string | null>(null);
const showRenameModal = ref(false);
const renameFileName = ref("");
const renameFileId = ref<string | null>(null);
const deletingFileId = ref<string | null>(null);

const fuse = computed(
  () =>
    new Fuse<GistIndexItem>(workspaceStore.currentFileList, {
      keys: ["title", { name: "tags", weight: 0.7 }],
      threshold: 0.3,
      ignoreLocation: true,
    }),
);

const filteredList = computed(() => {
  const list = workspaceStore.currentFileList;
  if (!searchQuery.value) return list;
  return fuse.value.search(searchQuery.value).map((result) => result.item);
});

watch(showAddModal, (visible) => {
  if (!visible) {
    return;
  }
  newFileLanguage.value = workspaceStore.currentCategory?.defaultLanguage || "yaml";
});

function handleSelect(id: string) {
  selectionStore.selectFile(id);
}

async function handleAddFile() {
  if (!newFileName.value.trim()) {
    message.warning("请输入文件名");
    return;
  }
  if (!selectionStore.selectedCategoryId) {
    message.warning("请先选择一个分类");
    return;
  }
  isAdding.value = true;
  try {
    await workspaceStore.addFile(
      selectionStore.selectedCategoryId,
      newFileName.value.trim(),
      newFileLanguage.value,
    );
    message.success("文件创建成功");
    showAddModal.value = false;
    newFileName.value = "";
    newFileLanguage.value = "yaml";
  } catch {
    message.error("创建失败");
  } finally {
    isAdding.value = false;
  }
}

function handleContextMenu(event: MouseEvent, fileId: string) {
  event.preventDefault();
  contextMenuFileId.value = fileId;
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  showContextMenu.value = true;
}

function handleClickOutside() {
  showContextMenu.value = false;
}

const contextMenuOptions = [
  { label: "重命名", key: "rename" },
  { label: "删除", key: "delete" },
];

async function handleContextMenuSelect(key: string) {
  showContextMenu.value = false;
  const fileId = contextMenuFileId.value;
  if (!fileId || !selectionStore.selectedCategoryId) return;

  if (key === "rename") {
    const file = workspaceStore.currentFileList.find((item) => item.id === fileId);
    if (!file) {
      return;
    }
    renameFileId.value = fileId;
    renameFileName.value = file.title;
    showRenameModal.value = true;
    return;
  }

  const file = workspaceStore.currentFileList.find((item) => item.id === fileId);
  dialog.warning({
    title: "确认删除",
    content: `确定要删除配置「${file?.title}」吗？此操作不可撤销。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: () => {
      deletingFileId.value = fileId;
      const deletingMessage = message.loading("删除中...", { duration: 0 });
      void (async () => {
        try {
          await workspaceStore.deleteFile(selectionStore.selectedCategoryId!, fileId);
          message.success("已删除");
        } catch {
          message.error("删除失败");
        } finally {
          deletingMessage.destroy();
          deletingFileId.value = null;
        }
      })();
    },
  });
}

async function handleRenameFile() {
  if (!renameFileName.value.trim() || !renameFileId.value) return;
  try {
    await workspaceStore.updateFile(renameFileId.value, {
      title: renameFileName.value.trim(),
    });
    message.success("已重命名");
    showRenameModal.value = false;
  } catch {
    message.error("重命名失败");
  }
}
</script>

<template>
  <div
    class="h-full flex flex-col transition-colors duration-200"
    :class="themeStore.isDark ? 'bg-slate-800/50' : 'bg-slate-50'"
  >
    <div
      class="p-4 border-b transition-colors duration-200"
      :class="themeStore.isDark ? 'border-slate-700/50' : 'border-slate-200'"
    >
      <NInput
        v-model:value="searchQuery"
        placeholder="搜索..."
        clearable
        size="small"
        :class="themeStore.isDark ? 'bg-slate-900 border-none' : ''"
      >
        <template #prefix>
          <div class="i-heroicons-magnifying-glass w-4 h-4 text-slate-500"></div>
        </template>
      </NInput>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div
        v-if="!selectionStore.selectedCategoryId"
        class="p-8 text-center text-sm"
        :class="themeStore.isDark ? 'text-slate-500' : 'text-slate-400'"
      >
        请选择一个分类
      </div>

      <NEmpty v-else-if="filteredList.length === 0" description="暂无内容" class="mt-10" />

      <div v-else class="py-2">
        <div
          v-for="item in filteredList"
          :key="item.id"
          class="mx-2 mb-1 px-3 py-2.5 rounded-md cursor-pointer transition-all duration-300 relative"
          :class="[
            deletingFileId === item.id
              ? 'opacity-40 pointer-events-none scale-95'
              : selectionStore.selectedFileId === item.id
                ? 'bg-blue-500/20 border-l-2 border-blue-500'
                : themeStore.isDark
                  ? 'hover:bg-slate-700/50'
                  : 'hover:bg-slate-200/50',
          ]"
          @click="handleSelect(item.id)"
          @contextmenu="handleContextMenu($event, item.id)"
        >
          <div
            v-if="deletingFileId === item.id"
            class="absolute inset-0 flex items-center justify-center"
          >
            <div class="i-heroicons-arrow-path animate-spin w-5 h-5 text-red-400"></div>
          </div>
          <div class="font-medium" :class="themeStore.isDark ? 'text-slate-200' : 'text-slate-700'">
            {{ item.title }}
          </div>
          <div
            v-if="item.tags?.length"
            class="flex items-center mt-1.5 space-x-1.5 flex-wrap gap-y-1"
          >
            <span
              v-for="tag in item.tags"
              :key="tag"
              class="text-xs px-1.5 py-0.5 rounded"
              :class="themeStore.isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-500'"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div
      class="p-3 border-t transition-colors duration-200"
      :class="themeStore.isDark ? 'border-slate-700/50' : 'border-slate-200'"
    >
      <NButton
        block
        size="small"
        dashed
        :disabled="!selectionStore.selectedCategoryId"
        @click="showAddModal = true"
      >
        <template #icon>
          <div class="i-heroicons-plus w-4 h-4"></div>
        </template>
        新建配置
      </NButton>
    </div>

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

    <NModal v-model:show="showAddModal" preset="dialog" title="新建配置">
      <div class="space-y-4">
        <NInput
          v-model:value="newFileName"
          placeholder="输入配置名称"
          @keydown.enter="handleAddFile"
        />
        <NSelect
          v-model:value="newFileLanguage"
          :options="languageOptions"
          placeholder="选择语言"
        />
      </div>
      <template #action>
        <NSpace>
          <NButton @click="showAddModal = false">取消</NButton>
          <NButton type="primary" :loading="isAdding" @click="handleAddFile">创建</NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal v-model:show="showRenameModal" preset="dialog" title="重命名配置">
      <NInput
        v-model:value="renameFileName"
        placeholder="输入新名称"
        @keydown.enter="handleRenameFile"
      />
      <template #action>
        <NSpace>
          <NButton @click="showRenameModal = false">取消</NButton>
          <NButton type="primary" @click="handleRenameFile">确定</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
