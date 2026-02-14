<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useNexusStore } from "../stores/useNexusStore";
import { NModal, NInput, NScrollbar } from "naive-ui";
import Fuse from "fuse.js";

interface SearchItem {
  type: "category" | "file";
  id: string;
  categoryId?: string;
  title: string;
  categoryName?: string;
  icon?: string;
}

const nexusStore = useNexusStore();

const show = ref(false);
const searchQuery = ref("");
const selectedIndex = ref(0);
const inputRef = ref<InstanceType<typeof NInput> | null>(null);

// 构建搜索列表
const allItems = computed<SearchItem[]>(() => {
  if (!nexusStore.index) return [];

  const items: SearchItem[] = [];

  for (const cat of nexusStore.index.categories) {
    // 添加分类
    items.push({
      type: "category",
      id: cat.id,
      title: cat.name,
      icon: cat.icon,
    });

    // 添加分类下的文件
    for (const file of cat.items) {
      items.push({
        type: "file",
        id: file.id,
        categoryId: cat.id,
        title: file.title,
        categoryName: cat.name,
      });
    }
  }

  return items;
});

// Fuse 搜索
const fuse = computed(
  () =>
    new Fuse(allItems.value, {
      keys: ["title", "categoryName"],
      threshold: 0.4,
      ignoreLocation: true,
    }),
);

const filteredItems = computed(() => {
  if (!searchQuery.value) return allItems.value.slice(0, 10);
  return fuse.value
    .search(searchQuery.value)
    .slice(0, 10)
    .map((r: any) => r.item);
});

// 重置选择索引
watch(filteredItems, () => {
  selectedIndex.value = 0;
});

// 打开搜索
function openSearch() {
  show.value = true;
  searchQuery.value = "";
  selectedIndex.value = 0;
  // 聚焦输入框
  setTimeout(() => {
    inputRef.value?.focus();
  }, 100);
}

// 关闭
function closeSearch() {
  show.value = false;
}

// 选择项目
function selectItem(item: SearchItem) {
  if (item.type === "category") {
    nexusStore.selectedCategoryId = item.id;
    nexusStore.selectedFileId = null;
  } else {
    nexusStore.selectedCategoryId = item.categoryId!;
    nexusStore.selectedFileId = item.id;
  }
  closeSearch();
}

// 键盘导航
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIndex.value = Math.min(
      selectedIndex.value + 1,
      filteredItems.value.length - 1,
    );
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const item = filteredItems.value[selectedIndex.value];
    if (item) selectItem(item);
  } else if (e.key === "Escape") {
    closeSearch();
  }
}

// 全局快捷键
function handleGlobalKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "p") {
    e.preventDefault();
    openSearch();
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleGlobalKeyDown);
});

// 暴露方法供外部调用
defineExpose({ openSearch });
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :bordered="false"
    :closable="false"
    size="small"
    style="width: 500px; max-width: 90vw"
    class="global-search-modal"
    :mask-closable="true"
    @keydown="handleKeyDown"
  >
    <div class="space-y-3">
      <!-- 搜索输入 -->
      <NInput
        ref="inputRef"
        v-model:value="searchQuery"
        placeholder="搜索分类或配置..."
        size="large"
        clearable
      >
        <template #prefix>
          <div
            class="i-heroicons-magnifying-glass w-5 h-5 text-slate-400"
          ></div>
        </template>
      </NInput>

      <!-- 搜索结果 -->
      <NScrollbar style="max-height: 320px">
        <div class="space-y-1">
          <div
            v-for="(item, index) in filteredItems"
            :key="`${item.type}-${item.id}`"
            class="px-3 py-2.5 rounded-md cursor-pointer transition-all duration-150"
            :class="[
              selectedIndex === index
                ? 'bg-blue-500/20 text-blue-500'
                : 'hover:bg-slate-100 dark:hover:bg-slate-700/50',
            ]"
            @click="selectItem(item)"
            @mouseenter="selectedIndex = index"
          >
            <div class="flex items-center">
              <div
                class="w-5 h-5 mr-3"
                :class="[
                  item.type === 'category'
                    ? 'i-heroicons-folder'
                    : 'i-heroicons-document-text',
                  'text-slate-500 dark:text-slate-400',
                ]"
              ></div>
              <div class="flex-1 min-w-0">
                <div
                  class="font-medium truncate text-slate-700 dark:text-slate-200"
                >
                  {{ item.title }}
                </div>
                <div
                  v-if="item.categoryName"
                  class="text-xs truncate text-slate-400 dark:text-slate-500"
                >
                  {{ item.categoryName }}
                </div>
              </div>
              <div
                class="text-xs ml-2 text-slate-400 dark:text-slate-500"
              >
                {{ item.type === "category" ? "分类" : "配置" }}
              </div>
            </div>
          </div>

          <div
            v-if="filteredItems.length === 0"
            class="py-8 text-center text-slate-400 dark:text-slate-500"
          >
            未找到匹配项
          </div>
        </div>
      </NScrollbar>

      <!-- 快捷键提示 -->
      <div
        class="flex items-center justify-center text-xs pt-2 border-t text-slate-400 border-slate-200 dark:text-slate-500 dark:border-slate-700"
      >
        <span
          class="px-1.5 py-0.5 rounded mr-1 bg-slate-200 dark:bg-slate-700"
          >↑↓</span
        >
        导航
        <span
          class="px-1.5 py-0.5 rounded mx-2 bg-slate-200 dark:bg-slate-700"
          >Enter</span
        >
        选择
        <span
          class="px-1.5 py-0.5 rounded ml-1 bg-slate-200 dark:bg-slate-700"
          >Esc</span
        >
        关闭
      </div>
    </div>
  </NModal>
</template>

<style>
.global-search-modal .n-card {
  backdrop-filter: blur(12px);
}
</style>
