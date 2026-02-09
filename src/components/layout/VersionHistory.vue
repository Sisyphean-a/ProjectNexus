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
import { gistRepository } from "../../infrastructure";
import { useNexusStore } from "../../stores/useNexusStore";
import { useThemeStore } from "../../stores/useThemeStore";
import type { GistHistoryEntry } from "../../core/domain/entities/types";
import type { HistoryEntry } from "../../infrastructure/db/NexusDatabase";

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

const nexusStore = useNexusStore();
const themeStore = useThemeStore();

const activeTab = ref("local"); // local | remote

// Local History State
const localHistory = ref<HistoryEntry[]>([]);
const localLoading = ref(false);

// Remote History State
const remoteHistory = ref<GistHistoryEntry[]>([]);
const remoteLoading = ref(false);

// Cache: version -> content
const contentCache = ref<Map<string, string>>(new Map());

// Clear cache when filename changes
watch(
  () => props.filename,
  () => {
    contentCache.value.clear();
  },
);

// Selected State
const selectedVersionId = ref<string | number | null>(null);
const originalContent = ref(""); // The 'original' content for diff (History Version)
const modifiedContent = ref(""); // The 'modified' content for diff (Current Version)





// Load Local History
async function loadLocalHistory() {
  if (!props.fileId) return;
  localLoading.value = true;
  try {
    localHistory.value = await nexusStore.getFileHistory(props.fileId);

    // Auto select logic:
    // If the latest version (index 0) is identical to current content, users usually want to see the PREVIOUS version to rollback.
    // So we try to find the first version that is DIFFERENT from currentContent.
    if (localHistory.value.length > 0) {
      const differentVersion = localHistory.value.find(
        (h) => h.content !== props.currentContent,
      );
      if (differentVersion) {
        selectLocalVersion(differentVersion);
      } else {
        // All same? Just select the first one.
        selectLocalVersion(localHistory.value[0]);
      }
    }
  } catch (e) {
    console.error("Failed to load local history", e);
  } finally {
    localLoading.value = false;
  }
}

// Load Remote History
async function loadRemoteHistory() {
  if (!nexusStore.currentGistId) return;
  remoteLoading.value = true;
  try {
    const allCommits = await gistRepository.getGistHistory(
      nexusStore.currentGistId,
    );

    // Smart Filter: Content Change Detection
    // We fetch details for the top 20 commits and compare file content between versions.
    const candidates = allCommits.slice(0, 20);

    // Fetch all contents in parallel
    const versionContents = await Promise.all(
      candidates.map(async (commit) => {
        try {
          // Check Cache first
          if (contentCache.value.has(commit.version)) {
            return contentCache.value.get(commit.version)!;
          }

          const files = await gistRepository.getGistVersion(
            nexusStore.currentGistId!,
            commit.version,
          );
          const content =
            files && files[props.filename]
              ? files[props.filename].content
              : null;

          // Set Cache
          if (content !== null) {
            contentCache.value.set(commit.version, content);
          }

          return content;
        } catch (e) {
          return null;
        }
      }),
    );

    // Filter based on change
    const filtered: GistHistoryEntry[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const currentContent = versionContents[i];

      // If file doesn't exist in this version, skip
      if (currentContent === null) continue;

      // If it's the last item in our fetched list, we allow it (baseline)
      if (i === candidates.length - 1) {
        filtered.push(candidates[i]);
        continue;
      }

      // Check next (older) version
      const prevContent = versionContents[i + 1];

      // If content differs from previous (older) version, then THIS commit changed it.
      // Also if prevContent is null (file created in this commit), it's a change
      if (currentContent !== prevContent) {
        filtered.push(candidates[i]);
      }
    }

    remoteHistory.value = filtered;
  } catch (e) {
    console.error("Failed to load remote history", e);
  } finally {
    remoteLoading.value = false;
  }
}

// Select Local Version
function selectLocalVersion(item: HistoryEntry) {
  selectedVersionId.value = item.id || null;
  originalContent.value = item.content; // Left side: History
}

// Select Remote Version
async function selectRemoteVersion(item: GistHistoryEntry) {
  if (!nexusStore.currentGistId) return;
  selectedVersionId.value = item.version;

  // Use Cache
  if (contentCache.value.has(item.version)) {
    originalContent.value = contentCache.value.get(item.version)!;
    return;
  }

  // Load content
  try {
    const files = await gistRepository.getGistVersion(
      nexusStore.currentGistId,
      item.version,
    );
    const file = files[props.filename];
    const content = file?.content || "(File not found in this version)";
    originalContent.value = content;

    // Cache it too
    if (file?.content) {
      contentCache.value.set(item.version, file.content);
    }
  } catch (e) {
    originalContent.value = "Error loading content";
  }
}

// Restore
async function handleRestore() {
  if (originalContent.value) {
    if (activeTab.value === "local" && props.fileId) {
      await nexusStore.restoreFileContent(props.fileId, originalContent.value);
      emit("restore", originalContent.value); // Tell parent to update editor
    } else {
      emit("restore", originalContent.value);
    }
    emit("update:show", false);
  }
}

// Import
const importing = ref(false);

async function handleImportHistory() {
  if (!props.fileId) return;

  importing.value = true;
  try {
    const count = await nexusStore.importRemoteHistory(
      props.fileId,
      props.filename,
    );
    if (count && count > 0) {
      await loadLocalHistory(); // Refresh list
    }
  } catch (e) {
    console.error("Import failed", e);
  } finally {
    importing.value = false;
  }
}

// Watchers
watch(
  () => props.show,
  (show) => {
    if (show) {
      // Reset State
      selectedVersionId.value = null;
      originalContent.value = "";

      modifiedContent.value = props.currentContent;
      // If local is empty, maybe try to load?
      if (activeTab.value === "local") loadLocalHistory();
      else loadRemoteHistory();
    }
  },
);

watch(activeTab, (tab) => {
  if (tab === "local") loadLocalHistory();
  else loadRemoteHistory();
});

// Format Time
function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString();
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
      <!-- Sidebar: History List -->
      <div
        class="w-1/4 min-w-[300px] flex flex-col border-r pr-4 border-gray-200 dark:border-gray-700 min-h-0"
      >
        <NTabs v-model:value="activeTab" type="segment" class="mb-4 shrink-0">
          <NTabPane name="local" tab="本地历史" />
          <NTabPane name="remote" tab="远程 Gist" />
        </NTabs>

        <div class="flex-1 overflow-y-auto min-h-0">
          <!-- Local History List -->
          <div v-if="activeTab === 'local'">
            <div v-if="localLoading" class="flex justify-center p-4">
              <NSpin />
            </div>
            <div
              v-else-if="localHistory.length === 0"
              class="flex flex-col items-center justify-center py-8 gap-4"
            >
              <NEmpty description="暂无本地修改记录" />
              <!-- Import Button if empty -->
              <NButton
                secondary
                type="primary"
                :loading="importing"
                @click="handleImportHistory"
              >
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
                  :class="
                    selectedVersionId === item.id
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : ''
                  "
                  @click="selectLocalVersion(item)"
                />
              </NTimeline>

              <div class="mt-4 border-t pt-2 flex justify-center">
                <NButton
                  size="small"
                  dashed
                  @click="handleImportHistory"
                  :loading="importing"
                >
                  同步更多历史
                </NButton>
              </div>
            </div>
          </div>

          <!-- Remote History List -->
          <div v-else>
            <div v-if="remoteLoading" class="flex justify-center p-4">
              <NSpin />
            </div>
            <NEmpty
              v-else-if="remoteHistory.length === 0"
              description="暂无 Gist 提交记录"
            />
            <NTimeline v-else>
              <NTimelineItem
                v-for="item in remoteHistory"
                :key="item.version"
                type="success"
                :time="formatTime(item.committedAt)"
                class="cursor-pointer p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                :class="
                  selectedVersionId === item.version
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : ''
                "
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

      <!-- Main Content: Diff Editor -->
      <div class="flex-1 flex flex-col h-full overflow-hidden min-h-0">
        <div class="mb-4 flex justify-between items-center shrink-0">
          <div class="text-sm text-gray-500 flex items-center gap-4">
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 rounded-full bg-red-500/50"></div>
              <span
                >左侧: 历史版本 ({{
                  selectedVersionId
                    ? activeTab === "local"
                      ? "Local Snapshot"
                      : "Gist Commit"
                    : "未选择"
                }})</span
              >
            </div>
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 rounded-full bg-green-500/50"></div>
              <span>右侧: 当前编辑内容</span>
            </div>
          </div>
          <div class="flex gap-2">
            <NButton
              v-if="selectedVersionId"
              @click="selectedVersionId = null"
              size="small"
              >关闭对比</NButton
            >
            <NButton
              type="warning"
              @click="handleRestore"
              :disabled="!selectedVersionId"
            >
              恢复此版本
            </NButton>
          </div>
        </div>

        <div
          class="flex-1 border border-gray-200 dark:border-gray-700 rounded overflow-hidden relative min-h-0"
        >
          <div
            v-if="originalContent === modifiedContent && selectedVersionId"
            class="absolute inset-0 z-10 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 pointer-events-none"
          >
            <div class="text-gray-500 font-medium">
              ✨ 此版本与当前内容完全一致
            </div>
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
