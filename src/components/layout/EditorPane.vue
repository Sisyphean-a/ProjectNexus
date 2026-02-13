<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useNexusStore } from "../../stores/useNexusStore";
import { useThemeStore } from "../../stores/useThemeStore";
import {
  NButton,
  NSwitch,
  NSelect,
  NTooltip,
  NButtonGroup,
  NSlider,
  NPopover,
  NModal,
  NInput,
  useMessage,
  useDialog,
} from "naive-ui";
import CodeMirrorEditor from "../CodeMirrorEditor.vue";
import VersionHistory from "./VersionHistory.vue";
import { cryptoProvider } from "../../services";
import { DECRYPTION_PENDING_PREFIX } from "../../core/application/services/SyncService";
import { localHistoryRepository } from "../../infrastructure/storage/LocalHistoryRepository";
import { languageOptions } from "../../constants/languages";

const emit = defineEmits<{
  "open-search": [];
}>();

const nexusStore = useNexusStore();
const themeStore = useThemeStore();

const message = useMessage();
const dialog = useDialog();

// 主题图标
function getThemeIcon() {
  if (themeStore.mode === "dark") return "i-heroicons-moon";
  if (themeStore.mode === "light") return "i-heroicons-sun";
  return "i-heroicons-computer-desktop";
}

function getThemeLabel() {
  if (themeStore.mode === "dark") return "深色";
  if (themeStore.mode === "light") return "浅色";
  return "自动";
}

// 编辑器状态
const code = ref("");
const language = ref("yaml");
const isDirty = ref(false);
const isLoadingContent = ref(false);
const isReadOnly = ref(false);
const isSaving = ref(false);

// 编辑器增强

// 编辑器增强
const fontSize = ref(14);
const showHistoryPanel = ref(false);
const showExportModal = ref(false);
const exportBaseName = ref("");
const exportExtension = ref("");
const isExporting = ref(false);
const exportNameInputRef = ref<InstanceType<typeof NInput> | null>(null);

// 选中的文件
const selectedFile = computed(() => {
  if (!nexusStore.selectedFileId) return null;
  return (
    nexusStore.currentFileList.find(
      (f) => f.id === nexusStore.selectedFileId,
    ) || null
  );
});

// 检测文件是否处于待解密状态
const isDecryptionPending = computed(() => {
  return code.value.startsWith(DECRYPTION_PENDING_PREFIX);
});



function getSuffixFromFilename(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === filename.length - 1) return "";
  return filename.slice(lastDotIndex + 1);
}

function sanitizeExtension(rawExtension: string): string {
  return rawExtension
    .trim()
    .replace(/^\.+/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeBaseName(rawName: string): string {
  return rawName.trim().replace(/[\\/:*?"<>|]/g, "_");
}

async function openExportModal() {
  if (!selectedFile.value) return;

  exportBaseName.value = selectedFile.value.title?.trim() || "untitled";
  exportExtension.value = getSuffixFromFilename(selectedFile.value.gist_file || "");
  showExportModal.value = true;

  await nextTick();
  exportNameInputRef.value?.focus();
}

async function confirmExport() {
  if (isExporting.value) return;

  isExporting.value = true;
  try {
    const finalBaseName = sanitizeBaseName(exportBaseName.value) || "untitled";
    const finalExtension = sanitizeExtension(exportExtension.value);
    const finalFilename = finalExtension
      ? `${finalBaseName}.${finalExtension}`
      : finalBaseName;

    const blob = new Blob([code.value ?? ""], {
      type: "text/plain;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = downloadUrl;
    anchor.download = finalFilename;
    anchor.style.display = "none";

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(downloadUrl);

    showExportModal.value = false;
    message.success("已导出文件");
  } catch (e) {
    console.error(e);
    message.error("导出失败");
  } finally {
    isExporting.value = false;
  }
}

function handleExportModalKeyDown(e: KeyboardEvent) {
  if (!showExportModal.value || e.isComposing) return;

  if (e.key === "Enter") {
    e.preventDefault();
    confirmExport();
  }
}

// 监听选择变化并加载内容
watch(
  () => nexusStore.selectedFileId,
  async (newId) => {
    if (!newId || !nexusStore.currentGistId) {
      code.value = "";
      return;
    }

    await loadFileContent();
  },
);

// 监听同步完成，刷新当前文件内容
watch(
  () => nexusStore.lastSyncedAt,
  async (newTime, oldTime) => {
    // 只在同步时间变化且有选中文件时刷新
    if (
      newTime &&
      newTime !== oldTime &&
      nexusStore.selectedFileId &&
      nexusStore.currentGistId
    ) {
      await loadFileContent();
    }
  },
);



// 语言变更状态
const isChangingLanguage = ref(false);
const isProgrammaticUpdate = ref(false);

// 加载文件内容
async function loadFileContent() {
  if (!nexusStore.selectedFileId) return;

  isLoadingContent.value = true;
  try {
    const content = await nexusStore.getFileContent(nexusStore.selectedFileId);
    code.value = content;

    // 从数据库读取语言
    const savedLanguage = await nexusStore.getFileLanguage(
      nexusStore.selectedFileId,
    );

    // 标记为程序化更新，防止触发 watcher
    isProgrammaticUpdate.value = true;
    language.value = savedLanguage;
    // 等待 watcher 处理完成（如果有）
    await nextTick();
    isProgrammaticUpdate.value = false;

    isDirty.value = false;


  } catch (e) {
    console.error(e);
    message.error("加载内容失败");
  } finally {
    isLoadingContent.value = false;
  }
}

// 自动保存逻辑
let autoSaveTimer: any = null;

// 清理定时器
const clearAutoSaveTimer = () => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
};

watch(code, (newVal) => {
  // 基础条件检查
  if (
    !nexusStore.selectedFileId ||
    isReadOnly.value ||
    isLoadingContent.value ||
    isDecryptionPending.value
  ) {
    return;
  }

  clearAutoSaveTimer();

  // 仅在 isDirty 为 true 时才考虑自动保存 (由 VueMonacoEditor @change 触发 isDirty)
  // 但这里 watch code 变化更直接。我们可以在 30s 后自动触发一次 "Auto Save" 快照
  // 注意：这不是 savedFileContent (同步到 Gist)，这只是本地历史快照

  autoSaveTimer = setTimeout(async () => {
    if (!nexusStore.selectedFileId) return;
    try {
      await localHistoryRepository.addSnapshot(
        nexusStore.selectedFileId,
        newVal,
        "auto",
        "自动保存",
      );
      // 自动保存后不清除 isDirty，因为并未同步到云端
    } catch (e) {
      console.warn("Auto save failed", e);
    }
  }, 30000); // 30s debounce
});

// 监听语言变化，同步更改云端文件扩展名
watch(language, async (newLang, oldLang) => {
  if (
    !nexusStore.selectedFileId ||
    isLoadingContent.value ||
    isChangingLanguage.value ||
    isProgrammaticUpdate.value
  )
    return;
  if (newLang === oldLang) return;

  isChangingLanguage.value = true;
  const changingMessage = message.loading("更改语言中...", { duration: 0 });

  try {
    const success = await nexusStore.changeFileLanguage(
      nexusStore.selectedFileId,
      newLang,
    );
    changingMessage.destroy();
    if (success) {
      message.success("语言已更改");
    } else {
      message.error("更改失败");
      isProgrammaticUpdate.value = true;
      language.value = oldLang; // 回滚
      await nextTick();
      isProgrammaticUpdate.value = false;
    }
  } catch (e) {
    changingMessage.destroy();
    message.error("更改语言失败");
    isProgrammaticUpdate.value = true;
    language.value = oldLang; // 回滚
    await nextTick();
    isProgrammaticUpdate.value = false;
    console.error(e);
  } finally {
    isChangingLanguage.value = false;
  }
});

// 保存
async function handleSave() {
  if (!nexusStore.selectedFileId || isSaving.value) return;

  isSaving.value = true;
  const savingMessage = message.loading("保存中...", { duration: 0 });
  try {
    await nexusStore.saveFileContent(nexusStore.selectedFileId, code.value);
    isDirty.value = false;
    message.success("已保存并同步");
  } catch (e) {
    message.error("保存失败");
    console.error(e);
  } finally {
    savingMessage.destroy();
    isSaving.value = false;
  }
}

// 切换安全状态
const isTogglingSecure = ref(false); // Add ref outside

async function handleToggleSecure() {
  if (
    !nexusStore.selectedFileId ||
    !selectedFile.value ||
    isTogglingSecure.value
  )
    return;

  const isCurrentlySecure = !!selectedFile.value.isSecure;

  // 如果要开启加密，必须先有密码
  if (!isCurrentlySecure && !cryptoProvider.hasPassword()) {
    dialog.warning({
      title: "需设置保险库密码",
      content: "启用加密前，请先在侧边栏设置保险库密码。",
      positiveText: "知道了",
    });
    return;
  }

  // 如果要关闭加密 (解密)，也需要密码确认 (实际 logic 中只要有密码即可，或验证一次)
  if (isCurrentlySecure && !cryptoProvider.hasPassword()) {
    // Should not happen if we persisted password, but safe check
    message.error("请先设置保险库密码以解密");
    return;
  }

  isTogglingSecure.value = true;
  const action = isCurrentlySecure ? "解密" : "加密";
  const loadingMsg = message.loading(`${action}中...`, { duration: 0 });

  try {
    await nexusStore.updateFileSecureStatus(
      nexusStore.selectedFileId,
      !isCurrentlySecure,
    );
    loadingMsg.destroy();
    message.success(`文件已${action}`);
  } catch (e: any) {
    loadingMsg.destroy();
    console.error(e);
    // 展示具体错误信息
    const errText = e.message || "未知错误";
    message.error(`${action}失败: ${errText}`);
  } finally {
    isTogglingSecure.value = false;
  }
}

// 复制全部
async function handleCopyAll() {
  try {
    await navigator.clipboard.writeText(code.value);
    message.success("已复制到剪贴板");
  } catch (e) {
    message.error("复制失败");
  }
}

// 快捷键
function handleKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented) return;

  const key = e.key.toLowerCase();
  const isFromCodeMirror = (e.target as HTMLElement | null)?.closest(".cm-editor");

  if ((e.ctrlKey || e.metaKey) && key === "s") {
    // 避免和 CodeMirror 内置 Mod-s 重复触发保存
    if (isFromCodeMirror) return;
    e.preventDefault();
    if (!isReadOnly.value) {
      handleSave();
    }
  }
  // Ctrl+G 跳转到行
  if ((e.ctrlKey || e.metaKey) && key === "g") {
    e.preventDefault();
  }
}
// 恢复历史版本
function handleRestoreVersion(content: string) {
  code.value = content;
  isDirty.value = true;
}


</script>

<template>
  <div class="h-full flex flex-col relative" @keydown="handleKeyDown">
    <!-- 头部工具栏 -->
    <div
      class="h-12 border-b flex items-center px-4 justify-between transition-colors duration-200"
      :class="
        themeStore.isDark
          ? 'border-slate-700 bg-slate-900'
          : 'border-slate-200 bg-white'
      "
    >
      <div class="flex items-center space-x-3 overflow-hidden">
        <div
          class="i-heroicons-document-text"
          :class="themeStore.isDark ? 'text-slate-500' : 'text-slate-400'"
        ></div>
        <span
          class="font-mono text-sm truncate max-w-[200px]"
          :class="[
            isDirty
              ? 'italic text-yellow-500'
              : themeStore.isDark
                ? 'text-slate-300'
                : 'text-slate-600',
          ]"
        >
          {{ selectedFile ? selectedFile.title : "未选择文件" }}
          <span v-if="isDirty">*</span>
        </span>

        <!-- 语言选择 -->
        <NSelect
          v-if="selectedFile"
          v-model:value="language"
          :options="languageOptions"
          size="tiny"
          style="width: 120px"
        />
      </div>

      <div class="flex items-center gap-2">
        <!-- 只读模式切换 -->
        <div
          v-if="selectedFile"
          class="flex items-center space-x-2 text-xs px-2"
          :class="themeStore.isDark ? 'text-slate-400' : 'text-slate-500'"
        >
          <span>只读</span>
          <NSwitch v-model:value="isReadOnly" size="small" />
        </div>

        <!-- 分隔符 -->
        <div
          v-if="selectedFile"
          class="h-5 w-px"
          :class="themeStore.isDark ? 'bg-slate-600' : 'bg-slate-300'"
        ></div>

        <!-- 文件操作按钮组 -->
        <NButtonGroup v-if="selectedFile" size="small">
          <!-- 历史记录按钮 -->
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton
                :quaternary="themeStore.isDark"
                :tertiary="!themeStore.isDark"
                @click="showHistoryPanel = true"
              >
                <template #icon>
                  <div class="i-heroicons-clock w-4 h-4"></div>
                </template>
              </NButton>
            </template>
            版本历史
          </NTooltip>

          <!-- 字体大小调整 -->
          <NPopover trigger="click" placement="bottom">
            <template #trigger>
              <NButton
                :quaternary="themeStore.isDark"
                :tertiary="!themeStore.isDark"
              >
                <template #icon>
                  <div class="i-heroicons-adjustments-horizontal w-4 h-4"></div>
                </template>
              </NButton>
            </template>
            <div class="w-40 p-2">
              <div
                class="text-xs mb-2"
                :class="themeStore.isDark ? 'text-slate-400' : 'text-slate-500'"
              >
                字体大小: {{ fontSize }}px
              </div>
              <NSlider v-model:value="fontSize" :min="10" :max="24" :step="1" />
            </div>
          </NPopover>

          <!-- 复制按钮 -->
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton
                :quaternary="themeStore.isDark"
                :tertiary="!themeStore.isDark"
                @click="handleCopyAll"
              >
                <template #icon>
                  <div class="i-heroicons-clipboard-document w-4 h-4"></div>
                </template>
              </NButton>
            </template>
            复制全部
          </NTooltip>

          <NTooltip trigger="hover">
            <template #trigger>
              <NButton
                :quaternary="themeStore.isDark"
                :tertiary="!themeStore.isDark"
                @click="openExportModal"
              >
                <template #icon>
                  <div class="i-heroicons-arrow-down-tray w-4 h-4"></div>
                </template>
              </NButton>
            </template>
            导出为文件
          </NTooltip>

          <NTooltip trigger="hover">
            <template #trigger>
              <NButton
                type="primary"
                :disabled="!isDirty || isReadOnly || isSaving"
                :loading="isSaving"
                @click="handleSave"
              >
                <template #icon>
                  <div class="i-heroicons-cloud-arrow-up w-4 h-4"></div>
                </template>
              </NButton>
            </template>
            保存 (Ctrl+S)
          </NTooltip>
        </NButtonGroup>

        <div
          v-if="selectedFile"
          class="h-5 w-px"
          :class="themeStore.isDark ? 'bg-slate-600' : 'bg-slate-300'"
        ></div>

        <NButtonGroup v-if="selectedFile" size="small">
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton
                :quaternary="themeStore.isDark"
                :tertiary="!themeStore.isDark"
                :disabled="isTogglingSecure"
                :loading="isTogglingSecure"
                @click="handleToggleSecure"
                :type="selectedFile.isSecure ? 'success' : 'default'"
              >
                <template #icon>
                  <div
                    :class="[
                      selectedFile.isSecure
                        ? 'i-heroicons-lock-closed'
                        : 'i-heroicons-lock-open',
                      'w-4 h-4',
                    ]"
                  ></div>
                </template>
              </NButton>
            </template>
            {{
              selectedFile.isSecure ? "已加密 (点击解密)" : "未加密 (点击加密)"
            }}
          </NTooltip>
        </NButtonGroup>

        <!-- 分隔符 -->
        <div
          class="h-5 w-px"
          :class="themeStore.isDark ? 'bg-slate-600' : 'bg-slate-300'"
        ></div>

        <!-- 全局操作按钮组 -->
        <NButtonGroup size="small">
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton
                :quaternary="themeStore.isDark"
                :tertiary="!themeStore.isDark"
                @click="emit('open-search')"
              >
                <template #icon>
                  <div class="i-heroicons-magnifying-glass w-4 h-4"></div>
                </template>
              </NButton>
            </template>
            搜索 (Ctrl+P)
          </NTooltip>

          <NTooltip trigger="hover">
            <template #trigger>
              <NButton
                :quaternary="themeStore.isDark"
                :tertiary="!themeStore.isDark"
                @click="themeStore.toggleTheme()"
              >
                <template #icon>
                  <div :class="`${getThemeIcon()} w-4 h-4`"></div>
                </template>
              </NButton>
            </template>
            {{ getThemeLabel() }}模式 (点击切换)
          </NTooltip>
        </NButtonGroup>
      </div>
    </div>

    <!-- 编辑器 -->
    <div
      class="flex-1 relative overflow-hidden"
      :class="themeStore.isDark ? 'bg-[#1e1e1e]' : 'bg-[#ffffff]'"
    >
      <div
        v-if="!selectedFile"
        class="absolute inset-0 flex items-center justify-center"
        :class="themeStore.isDark ? 'text-slate-600' : 'text-slate-400'"
      >
        <div class="text-center">
          <div
            class="i-heroicons-code-bracket-square w-16 h-16 mx-auto mb-4 opacity-20"
          ></div>
          <p class="text-lg">选择一个文件开始编辑</p>
          <p
            class="text-sm mt-2"
            :class="themeStore.isDark ? 'text-slate-500' : 'text-slate-400'"
          >
            在左侧列表选择配置文件
          </p>
        </div>
      </div>

      <CodeMirrorEditor
        v-else-if="!isDecryptionPending"
        v-model="code"
        :language="language"
        :theme="themeStore.isDark ? 'dark' : 'light'"
        :font-size="fontSize"
        :read-only="isReadOnly"
        @save="handleSave"
        @change="isDirty = true"
        class="h-full w-full"
      />

      <!-- 待解密状态提示 -->
      <div
        v-else-if="isDecryptionPending"
        class="absolute inset-0 flex items-center justify-center"
        :class="themeStore.isDark ? 'text-slate-400' : 'text-slate-500'"
      >
        <div class="text-center max-w-md p-6">
          <div
            class="i-heroicons-lock-closed w-16 h-16 mx-auto mb-4 text-amber-500 opacity-80"
          ></div>
          <p class="text-lg font-medium mb-2">此文件已加密</p>
          <p
            class="text-sm mb-4"
            :class="themeStore.isDark ? 'text-slate-500' : 'text-slate-400'"
          >
            请在侧边栏设置保险库密码后，点击同步按钮以解密内容
          </p>
          <div
            class="text-xs px-3 py-2 rounded-lg"
            :class="
              themeStore.isDark
                ? 'bg-slate-800 text-slate-400'
                : 'bg-slate-100 text-slate-500'
            "
          >
            提示：设置密码后系统将自动重新同步
          </div>
        </div>
      </div>

      <!-- 加载遮罩 -->
      <div
        v-if="isLoadingContent"
        class="absolute inset-0 backdrop-blur-sm flex items-center justify-center z-10"
        :class="themeStore.isDark ? 'bg-slate-900/70' : 'bg-white/70'"
      >
        <div class="flex flex-col items-center">
          <div
            class="i-heroicons-arrow-path animate-spin w-10 h-10 text-blue-500"
          ></div>
          <p
            class="mt-3"
            :class="themeStore.isDark ? 'text-slate-400' : 'text-slate-500'"
          >
            加载中...
          </p>
        </div>
      </div>

      <!-- 只读模式指示 -->
      <div
        v-if="isReadOnly && selectedFile"
        class="absolute top-4 right-4 px-3 py-1.5 bg-amber-500/20 text-amber-400 text-xs rounded-full border border-amber-500/30"
      >
        只读模式
      </div>
    </div>

    <!-- 版本历史面板 -->
    <NModal
      v-model:show="showExportModal"
      preset="card"
      title="导出为文件"
      size="small"
      style="width: 420px; max-width: 90vw"
      :mask-closable="false"
      @keydown="handleExportModalKeyDown"
    >
      <div class="space-y-3">
        <div class="space-y-1">
          <div
            class="text-xs"
            :class="themeStore.isDark ? 'text-slate-400' : 'text-slate-500'"
          >
            文件名称
          </div>
          <NInput
            ref="exportNameInputRef"
            v-model:value="exportBaseName"
            placeholder="请输入文件名称"
          />
        </div>

        <div class="space-y-1">
          <div
            class="text-xs"
            :class="themeStore.isDark ? 'text-slate-400' : 'text-slate-500'"
          >
            类型（后缀）
          </div>
          <NInput
            v-model:value="exportExtension"
            placeholder="例如 json / yaml / txt"
          />
        </div>

        <div
          class="text-xs"
          :class="themeStore.isDark ? 'text-slate-500' : 'text-slate-400'"
        >
          提示：按 Enter 可直接确认导出
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showExportModal = false">取消</NButton>
          <NButton type="primary" :loading="isExporting" @click="confirmExport">
            确认导出
          </NButton>
        </div>
      </template>
    </NModal>

    <VersionHistory
      v-model:show="showHistoryPanel"
      :filename="selectedFile?.gist_file || ''"
      :fileId="selectedFile?.id"
      :currentContent="code"
      :language="language"
      @restore="handleRestoreVersion"
    />
  </div>
</template>
