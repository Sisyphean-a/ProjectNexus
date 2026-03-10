<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";

const CodeMirrorEditor = defineAsyncComponent(() => import("../../CodeMirrorEditor.vue"));

const props = defineProps<{
  selectedFile: { id: string } | null;
  code: string;
  language: string;
  isDark: boolean;
  fontSize: number;
  isReadOnly: boolean;
  isLoadingContent: boolean;
  isDecryptionPending: boolean;
}>();

const emit = defineEmits<{
  "update:code": [value: string];
  save: [];
  dirty: [];
}>();

const editorModel = computed({
  get: () => props.code,
  set: (value: string) => emit("update:code", value),
});
</script>

<template>
  <div class="flex-1 relative overflow-hidden" :class="isDark ? 'bg-[#1e1e1e]' : 'bg-[#ffffff]'">
    <div
      v-if="!selectedFile"
      class="absolute inset-0 flex items-center justify-center"
      :class="isDark ? 'text-slate-600' : 'text-slate-400'"
    >
      <div class="text-center">
        <div class="i-heroicons-code-bracket-square w-16 h-16 mx-auto mb-4 opacity-20"></div>
        <p class="text-lg">选择一个文件开始编辑</p>
        <p class="text-sm mt-2" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
          在左侧列表选择配置文件
        </p>
      </div>
    </div>

    <CodeMirrorEditor
      v-else-if="!isDecryptionPending"
      v-model="editorModel"
      :language="language"
      :theme="isDark ? 'dark' : 'light'"
      :font-size="fontSize"
      :read-only="isReadOnly"
      class="h-full w-full"
      @save="emit('save')"
      @change="emit('dirty')"
    />

    <div
      v-else
      class="absolute inset-0 flex items-center justify-center"
      :class="isDark ? 'text-slate-400' : 'text-slate-500'"
    >
      <div class="text-center max-w-md p-6">
        <div class="i-heroicons-lock-closed w-16 h-16 mx-auto mb-4 text-amber-500 opacity-80"></div>
        <p class="text-lg font-medium mb-2">此文件已加密</p>
        <p class="text-sm mb-4" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
          请在侧边栏设置保险库密码后，点击同步按钮以解密内容
        </p>
        <div class="text-xs px-3 py-2 rounded-lg" :class="isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'">
          提示：设置密码后系统将自动重新同步
        </div>
      </div>
    </div>

    <div
      v-if="isLoadingContent"
      class="absolute inset-0 backdrop-blur-sm flex items-center justify-center z-10"
      :class="isDark ? 'bg-slate-900/70' : 'bg-white/70'"
    >
      <div class="flex flex-col items-center">
        <div class="i-heroicons-arrow-path animate-spin w-10 h-10 text-blue-500"></div>
        <p class="mt-3" :class="isDark ? 'text-slate-400' : 'text-slate-500'">加载中...</p>
      </div>
    </div>

    <div
      v-if="isReadOnly && selectedFile"
      class="absolute top-4 right-4 px-3 py-1.5 bg-amber-500/20 text-amber-400 text-xs rounded-full border border-amber-500/30"
    >
      只读模式
    </div>
  </div>
</template>
