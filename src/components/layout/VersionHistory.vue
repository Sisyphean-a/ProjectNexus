<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  NDrawer,
  NDrawerContent,
  NTimeline,
  NTimelineItem,
  NButton,
  NEmpty,
  NSpin,
  NTag,
} from "naive-ui";
import { gistRepository } from "../../infrastructure";
import { useNexusStore } from "../../stores/useNexusStore";
import { useThemeStore } from "../../stores/useThemeStore";
import type { GistHistoryEntry } from "../../core/domain/types";

const props = defineProps<{
  show: boolean;
  filename: string;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  restore: [content: string];
}>();

const nexusStore = useNexusStore();
const themeStore = useThemeStore();

const loading = ref(false);
const history = ref<GistHistoryEntry[]>([]);
const selectedVersion = ref<string | null>(null);
const previewContent = ref<string | null>(null);
const previewLoading = ref(false);

// 加载历史记录
async function loadHistory() {
  if (!nexusStore.currentGistId) return;

  loading.value = true;
  try {
    history.value = await gistRepository.getGistHistory(
      nexusStore.currentGistId,
    );
  } catch (e) {
    console.error("获取版本历史失败", e);
  } finally {
    loading.value = false;
  }
}

// 预览特定版本
async function previewVersion(sha: string) {
  if (!nexusStore.currentGistId) return;

  selectedVersion.value = sha;
  previewLoading.value = true;

  try {
    const files = await gistRepository.getGistVersion(
      nexusStore.currentGistId,
      sha,
    );
    const file = files[props.filename];
    previewContent.value = file?.content || "(文件在此版本中不存在)";
  } catch (e) {
    console.error("获取版本内容失败", e);
    previewContent.value = "加载失败";
  } finally {
    previewLoading.value = false;
  }
}

// 恢复到选中版本
function restoreVersion() {
  if (
    previewContent.value &&
    previewContent.value !== "(文件在此版本中不存在)" &&
    previewContent.value !== "加载失败"
  ) {
    emit("restore", previewContent.value);
    emit("update:show", false);
  }
}

// 格式化时间
function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

  return date.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 监听显示状态，加载历史
watch(
  () => props.show,
  (show) => {
    if (show) {
      loadHistory();
      selectedVersion.value = null;
      previewContent.value = null;
    }
  },
);
</script>

<template>
  <NDrawer
    :show="show"
    :width="400"
    placement="right"
    @update:show="emit('update:show', $event)"
  >
    <NDrawerContent title="版本历史" closable>
      <template #header>
        <div class="flex items-center gap-2">
          <div class="i-heroicons-clock w-5 h-5 text-blue-500"></div>
          <span>版本历史</span>
        </div>
      </template>

      <div v-if="loading" class="flex justify-center py-8">
        <NSpin size="medium" />
      </div>

      <NEmpty v-else-if="history.length === 0" description="暂无历史记录" />

      <div v-else class="space-y-4">
        <NTimeline>
          <NTimelineItem
            v-for="(item, index) in history"
            :key="item.version"
            :type="selectedVersion === item.version ? 'success' : 'default'"
          >
            <template #header>
              <div
                class="cursor-pointer px-2 py-1 rounded transition-colors"
                :class="[
                  selectedVersion === item.version
                    ? 'bg-blue-500/20'
                    : themeStore.isDark
                      ? 'hover:bg-slate-700'
                      : 'hover:bg-slate-100',
                ]"
                @click="previewVersion(item.version)"
              >
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium">
                    {{
                      index === 0
                        ? "当前版本"
                        : `版本 ${history.length - index}`
                    }}
                  </span>
                  <NTag v-if="index === 0" size="small" type="success"
                    >最新</NTag
                  >
                </div>
                <div
                  class="text-xs mt-1"
                  :class="
                    themeStore.isDark ? 'text-slate-400' : 'text-slate-500'
                  "
                >
                  {{ formatTime(item.committedAt) }}
                </div>
                <div
                  v-if="item.changeStatus.total > 0"
                  class="text-xs mt-1 flex gap-2"
                >
                  <span class="text-green-500"
                    >+{{ item.changeStatus.additions }}</span
                  >
                  <span class="text-red-500"
                    >-{{ item.changeStatus.deletions }}</span
                  >
                </div>
              </div>
            </template>
          </NTimelineItem>
        </NTimeline>

        <!-- 预览区域 -->
        <div
          v-if="selectedVersion"
          class="border-t pt-4"
          :class="themeStore.isDark ? 'border-slate-700' : 'border-slate-200'"
        >
          <div class="flex items-center justify-between mb-2">
            <span
              class="text-sm font-medium"
              :class="themeStore.isDark ? 'text-slate-300' : 'text-slate-600'"
              >内容预览</span
            >
            <NButton
              size="small"
              type="primary"
              :disabled="
                !previewContent ||
                previewContent === '(文件在此版本中不存在)' ||
                previewContent === '加载失败'
              "
              @click="restoreVersion"
            >
              恢复此版本
            </NButton>
          </div>

          <div v-if="previewLoading" class="flex justify-center py-4">
            <NSpin size="small" />
          </div>

          <pre
            v-else
            class="text-xs p-3 rounded-lg overflow-auto max-h-48 font-mono"
            :class="
              themeStore.isDark
                ? 'bg-slate-800 text-slate-300'
                : 'bg-slate-100 text-slate-700'
            "
            >{{ previewContent }}</pre
          >
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>
