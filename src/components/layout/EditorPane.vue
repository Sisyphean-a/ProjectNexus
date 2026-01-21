<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useNexusStore } from "../../stores/useNexusStore";
import { useThemeStore } from "../../stores/useThemeStore";
import { gistRepository } from "../../infrastructure";
import { NButton, NSwitch, NSelect, useMessage } from "naive-ui";
import { VueMonacoEditor } from "@guolao/vue-monaco-editor";

const nexusStore = useNexusStore();
const themeStore = useThemeStore();
const message = useMessage();

// 编辑器状态
const code = ref("");
const language = ref("yaml");
const isDirty = ref(false);
const isLoadingContent = ref(false);
const isReadOnly = ref(false);

// 语言选项
const languageOptions = [
  { label: "YAML", value: "yaml" },
  { label: "JSON", value: "json" },
  { label: "Markdown", value: "markdown" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "纯文本", value: "plaintext" },
];

// 选中的文件
const selectedFile = computed(() => {
  if (!nexusStore.selectedFileId) return null;
  return (
    nexusStore.currentFileList.find(
      (f) => f.id === nexusStore.selectedFileId,
    ) || null
  );
});

// 监听选择变化并加载内容
watch(
  () => nexusStore.selectedFileId,
  async (newId) => {
    if (!newId || !nexusStore.currentGistId) {
      code.value = "";
      return;
    }

    isLoadingContent.value = true;
    try {
      const files = await gistRepository.getGistContent(
        nexusStore.currentGistId,
      );
      const file = files[selectedFile.value?.gist_file || ""];

      if (file) {
        code.value = file.content;
        // 自动检测语言
        const ext = file.filename.split(".").pop();
        if (ext === "md") language.value = "markdown";
        else if (ext === "json") language.value = "json";
        else if (ext === "js") language.value = "javascript";
        else if (ext === "ts") language.value = "typescript";
        else if (ext === "py") language.value = "python";
        else language.value = "yaml";

        isDirty.value = false;
      } else {
        code.value = "";
      }
    } catch (e) {
      console.error(e);
      message.error("加载内容失败");
    } finally {
      isLoadingContent.value = false;
    }
  },
);

// 保存
async function handleSave() {
  if (!selectedFile.value || !nexusStore.currentGistId) return;

  const savingMessage = message.loading("保存中...", { duration: 0 });
  try {
    await gistRepository.updateGistFile(
      nexusStore.currentGistId,
      selectedFile.value.gist_file,
      code.value,
    );
    isDirty.value = false;
    savingMessage.destroy();
    message.success("已保存");
  } catch (e) {
    savingMessage.destroy();
    message.error("保存失败");
    console.error(e);
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
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    if (!isReadOnly.value) {
      handleSave();
    }
  }
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

      <div class="flex items-center space-x-3">
        <!-- 只读模式切换 -->
        <div
          v-if="selectedFile"
          class="flex items-center space-x-2 text-xs"
          :class="themeStore.isDark ? 'text-slate-400' : 'text-slate-500'"
        >
          <span>只读</span>
          <NSwitch v-model:value="isReadOnly" size="small" />
        </div>

        <!-- 复制按钮 -->
        <NButton
          v-if="selectedFile"
          size="small"
          type="info"
          ghost
          @click="handleCopyAll"
        >
          <template #icon>
            <div class="i-heroicons-clipboard-document w-4 h-4"></div>
          </template>
          复制全部
        </NButton>

        <!-- 保存按钮 -->
        <NButton
          v-if="selectedFile"
          size="small"
          type="primary"
          :disabled="!isDirty || isReadOnly"
          @click="handleSave"
        >
          <template #icon>
            <div class="i-heroicons-cloud-arrow-up w-4 h-4"></div>
          </template>
          保存
        </NButton>
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

      <VueMonacoEditor
        v-else
        v-model:value="code"
        :language="language"
        :theme="themeStore.isDark ? 'vs-dark' : 'vs'"
        :options="{
          automaticLayout: true,
          fontSize: 14,
          fontFamily: 'Fira Code, Consolas, monospace',
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          padding: { top: 16 },
          readOnly: isReadOnly,
          wordWrap: 'on',
          lineNumbers: 'on',
          renderLineHighlight: 'all',
          cursorBlinking: 'smooth',
          smoothScrolling: true,
        }"
        @change="isDirty = true"
        class="h-full w-full"
      />

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
  </div>
</template>
