<script setup lang="ts">
import { ref, watch } from "vue";
import {
  NButton,
  NEmpty,
  NSpin,
  NTabs,
  NTabPane,
  NModal,
  NTimeline,
  NTimelineItem,
} from "naive-ui";
import CodeMirrorMergeEditor from "../CodeMirrorMergeEditor.vue";
import { useThemeStore } from "../../stores/useThemeStore";
import { useHistoryStore } from "../../presentation/stores/useHistoryStore";
import type { GistHistoryEntry } from "../../core/domain/entities/types";

type LocalHistoryEntry = Awaited<
  ReturnType<ReturnType<typeof useHistoryStore>["getFileHistory"]>
>[number];

const props = defineProps<{
  show: boolean;
  filename: string;
  fileId?: string;
  currentContent: string;
  language?: string;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  restore: [content: string];
}>();

const historyStore = useHistoryStore();
const themeStore = useThemeStore();
const activeTab = ref("local");
const localHistory = ref<LocalHistoryEntry[]>([]);
const localLoading = ref(false);
const remoteHistory = ref<GistHistoryEntry[]>([]);
const remoteLoading = ref(false);
const contentCache = ref<Map<string, string>>(new Map());
const selectedVersionId = ref<string | number | null>(null);
const originalContent = ref("");
const modifiedContent = ref("");
const importing = ref(false);

watch(
  () => props.filename,
  () => {
    contentCache.value.clear();
  },
);

async function loadLocalHistory() {
  if (!props.fileId) return;
  localLoading.value = true;
  try {
    localHistory.value = await historyStore.getFileHistory(props.fileId);
    if (localHistory.value.length > 0) {
      const differentVersion = localHistory.value.find(
        (entry) => entry.content !== props.currentContent,
      );
      selectLocalVersion(differentVersion || localHistory.value[0]);
    }
  } catch (error) {
    console.error("Failed to load local history", error);
  } finally {
    localLoading.value = false;
  }
}

async function loadRemoteHistory() {
  remoteLoading.value = true;
  try {
    const allCommits = await historyStore.getRemoteHistory();
    const candidates = allCommits.slice(0, 20);
    const versionContents = await Promise.all(
      candidates.map(async (commit) => {
        if (contentCache.value.has(commit.version)) {
          return contentCache.value.get(commit.version)!;
        }
        const content = await historyStore.getRemoteVersionContent(
          commit.version,
          props.filename,
        );
        if (content !== null) {
          contentCache.value.set(commit.version, content);
        }
        return content;
      }),
    );

    const filtered: GistHistoryEntry[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const currentContent = versionContents[index];
      if (currentContent === null) {
        continue;
      }
      if (index === candidates.length - 1) {
        filtered.push(candidates[index]);
        continue;
      }
      const previousContent = versionContents[index + 1];
      if (currentContent !== previousContent) {
        filtered.push(candidates[index]);
      }
    }

    remoteHistory.value = filtered;
  } catch (error) {
    console.error("Failed to load remote history", error);
  } finally {
    remoteLoading.value = false;
  }
}

function selectLocalVersion(item: LocalHistoryEntry) {
  selectedVersionId.value = item.id || null;
  originalContent.value = item.content;
}

async function selectRemoteVersion(item: GistHistoryEntry) {
  selectedVersionId.value = item.version;
  if (contentCache.value.has(item.version)) {
    originalContent.value = contentCache.value.get(item.version)!;
    return;
  }
  const content = await historyStore.getRemoteVersionContent(item.version, props.filename);
  originalContent.value = content || "(File not found in this version)";
  if (content) {
    contentCache.value.set(item.version, content);
  }
}

async function handleRestore() {
  if (!originalContent.value) {
    return;
  }
  if (activeTab.value === "local" && props.fileId) {
    await historyStore.restoreFileContent(props.fileId, originalContent.value);
  }
  emit("restore", originalContent.value);
  emit("update:show", false);
}

async function handleImportHistory() {
  if (!props.fileId) return;
  importing.value = true;
  try {
    const count = await historyStore.importRemoteHistory(props.fileId, props.filename);
    if (count > 0) {
      await loadLocalHistory();
    }
  } catch (error) {
    console.error("Import failed", error);
  } finally {
    importing.value = false;
  }
}

watch(
  () => props.show,
  (show) => {
    if (!show) {
      return;
    }
    selectedVersionId.value = null;
    originalContent.value = "";
    modifiedContent.value = props.currentContent;
    if (activeTab.value === "local") {
      void loadLocalHistory();
    } else {
      void loadRemoteHistory();
    }
  },
);

watch(activeTab, (tab) => {
  if (tab === "local") {
    void loadLocalHistory();
    return;
  }
  void loadRemoteHistory();
});

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleString();
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="w-[95vw] h-[90vh] max-w-none max-h-none flex flex-col"
    content-style="flex: 1; overflow: hidden; min-height: 0;"
    title="历史回滚"
    size="huge"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex h-full gap-4 min-h-0">
      <div class="w-1/4 min-w-[300px] flex flex-col border-r pr-4 border-gray-200 dark:border-gray-700 min-h-0">
        <NTabs v-model:value="activeTab" type="segment" class="mb-4 shrink-0">
          <NTabPane name="local" tab="本地历史" />
          <NTabPane name="remote" tab="远程 Gist" />
        </NTabs>

        <div class="flex-1 overflow-y-auto min-h-0">
          <div v-if="activeTab === 'local'">
            <div v-if="localLoading" class="flex justify-center p-4">
              <NSpin />
            </div>
            <div
              v-else-if="localHistory.length === 0"
              class="flex flex-col items-center justify-center py-8 gap-4"
            >
              <NEmpty description="暂无本地修改记录" />
              <NButton secondary type="primary" :loading="importing" @click="handleImportHistory">
                从 Gist 导入最近 10 条
              </NButton>
            </div>
            <div v-else class="flex flex-col gap-2">
              <NTimeline>
                <NTimelineItem
                  v-for="item in localHistory"
                  :key="item.id"
                  type="info"
                  :title="item.type.toUpperCase()"
                  :content="item.note || formatTime(item.timestamp)"
                  :time="formatTime(item.timestamp)"
                  class="cursor-pointer p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                  :class="selectedVersionId === item.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''"
                  @click="selectLocalVersion(item)"
                />
              </NTimeline>

              <div class="mt-4 border-t pt-2 flex justify-center">
                <NButton size="small" dashed @click="handleImportHistory" :loading="importing">
                  同步更多历史
                </NButton>
              </div>
            </div>
          </div>

          <div v-else>
            <div v-if="remoteLoading" class="flex justify-center p-4">
              <NSpin />
            </div>
            <NEmpty v-else-if="remoteHistory.length === 0" description="暂无 Gist 提交记录" />
            <NTimeline v-else>
              <NTimelineItem
                v-for="item in remoteHistory"
                :key="item.version"
                type="success"
                :time="formatTime(item.committedAt)"
                class="cursor-pointer p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                :class="selectedVersionId === item.version ? 'bg-blue-50 dark:bg-blue-900/20' : ''"
                @click="selectRemoteVersion(item)"
              >
                <template #header>
                  <span>{{ item.changeStatus.total }} changes</span>
                </template>
              </NTimelineItem>
            </NTimeline>
          </div>
        </div>
      </div>

      <div class="flex-1 flex flex-col h-full overflow-hidden min-h-0">
        <div class="mb-4 flex justify-between items-center shrink-0">
          <div class="text-sm text-gray-500 flex items-center gap-4">
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 rounded-full bg-red-500/50"></div>
              <span>
                左侧: 历史版本 ({{ selectedVersionId ? activeTab === "local" ? "Local Snapshot" : "Gist Commit" : "未选择" }})
              </span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 rounded-full bg-green-500/50"></div>
              <span>右侧: 当前编辑内容</span>
            </div>
          </div>
          <div class="flex gap-2">
            <NButton v-if="selectedVersionId" @click="selectedVersionId = null" size="small">关闭对比</NButton>
            <NButton type="warning" @click="handleRestore" :disabled="!selectedVersionId">恢复此版本</NButton>
          </div>
        </div>

        <div class="flex-1 border border-gray-200 dark:border-gray-700 rounded overflow-hidden relative min-h-0">
          <div
            v-if="originalContent === modifiedContent && selectedVersionId"
            class="absolute inset-0 z-10 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 pointer-events-none"
          >
            <div class="text-gray-500 font-medium">✨ 此版本与当前内容完全一致</div>
          </div>

          <CodeMirrorMergeEditor
            v-else
            :original="originalContent"
            :modified="modifiedContent"
            :language="props.language || 'yaml'"
            :theme="themeStore.isDark ? 'dark' : 'light'"
            class="h-full w-full absolute inset-0"
          />
        </div>
      </div>
    </div>
  </NModal>
</template>

