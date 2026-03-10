<script setup lang="ts">
import { computed } from "vue";
import {
  NButton,
  NButtonGroup,
  NPopover,
  NSelect,
  NSlider,
  NSwitch,
  NTooltip,
} from "naive-ui";
import { languageOptions } from "../../../constants/languages";

const props = defineProps<{
  selectedFile: { title: string; isSecure?: boolean } | null;
  isDirty: boolean;
  language: string;
  isReadOnly: boolean;
  fontSize: number;
  isSaving: boolean;
  isTogglingSecure: boolean;
  themeMode: "dark" | "light" | "auto";
  isDark: boolean;
}>();

const emit = defineEmits<{
  "update:language": [value: string];
  "update:isReadOnly": [value: boolean];
  "update:fontSize": [value: number];
  "show-history": [];
  "copy-all": [];
  "export-file": [];
  save: [];
  "toggle-secure": [];
  "open-search": [];
  "toggle-theme": [];
}>();

const themeIcon = computed(() => {
  if (props.themeMode === "dark") return "i-heroicons-moon";
  if (props.themeMode === "light") return "i-heroicons-sun";
  return "i-heroicons-computer-desktop";
});

const themeLabel = computed(() => {
  if (props.themeMode === "dark") return "深色";
  if (props.themeMode === "light") return "浅色";
  return "自动";
});
</script>

<template>
  <div
    class="h-12 border-b flex items-center px-4 justify-between transition-colors duration-200"
    :class="isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'"
  >
    <div class="flex items-center space-x-3 overflow-hidden">
      <div class="i-heroicons-document-text" :class="isDark ? 'text-slate-500' : 'text-slate-400'"></div>
      <span
        class="font-mono text-sm truncate max-w-[200px]"
        :class="[
          isDirty
            ? 'italic text-yellow-500'
            : isDark
              ? 'text-slate-300'
              : 'text-slate-600',
        ]"
      >
        {{ selectedFile ? selectedFile.title : "未选择文件" }}
        <span v-if="isDirty">*</span>
      </span>

      <NSelect
        v-if="selectedFile"
        :value="language"
        :options="languageOptions"
        size="tiny"
        style="width: 120px"
        @update:value="emit('update:language', $event)"
      />
    </div>

    <div class="flex items-center gap-2">
      <div
        v-if="selectedFile"
        class="flex items-center space-x-2 text-xs px-2"
        :class="isDark ? 'text-slate-400' : 'text-slate-500'"
      >
        <span>只读</span>
        <NSwitch :value="isReadOnly" size="small" @update:value="emit('update:isReadOnly', $event)" />
      </div>

      <div v-if="selectedFile" class="h-5 w-px" :class="isDark ? 'bg-slate-600' : 'bg-slate-300'"></div>

      <NButtonGroup v-if="selectedFile" size="small">
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton :quaternary="isDark" :tertiary="!isDark" @click="emit('show-history')">
              <template #icon>
                <div class="i-heroicons-clock w-4 h-4"></div>
              </template>
            </NButton>
          </template>
          版本历史
        </NTooltip>

        <NPopover trigger="click" placement="bottom">
          <template #trigger>
            <NButton :quaternary="isDark" :tertiary="!isDark">
              <template #icon>
                <div class="i-heroicons-adjustments-horizontal w-4 h-4"></div>
              </template>
            </NButton>
          </template>
          <div class="w-40 p-2">
            <div class="text-xs mb-2" :class="isDark ? 'text-slate-400' : 'text-slate-500'">
              字体大小: {{ fontSize }}px
            </div>
            <NSlider :value="fontSize" :min="10" :max="24" :step="1" @update:value="emit('update:fontSize', $event)" />
          </div>
        </NPopover>

        <NTooltip trigger="hover">
          <template #trigger>
            <NButton :quaternary="isDark" :tertiary="!isDark" @click="emit('copy-all')">
              <template #icon>
                <div class="i-heroicons-clipboard-document w-4 h-4"></div>
              </template>
            </NButton>
          </template>
          复制全部
        </NTooltip>

        <NTooltip trigger="hover">
          <template #trigger>
            <NButton :quaternary="isDark" :tertiary="!isDark" @click="emit('export-file')">
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
              @click="emit('save')"
            >
              <template #icon>
                <div class="i-heroicons-cloud-arrow-up w-4 h-4"></div>
              </template>
            </NButton>
          </template>
          保存 (Ctrl+S)
        </NTooltip>
      </NButtonGroup>

      <div v-if="selectedFile" class="h-5 w-px" :class="isDark ? 'bg-slate-600' : 'bg-slate-300'"></div>

      <NButtonGroup v-if="selectedFile" size="small">
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton
              :quaternary="isDark"
              :tertiary="!isDark"
              :disabled="isTogglingSecure"
              :loading="isTogglingSecure"
              :type="selectedFile?.isSecure ? 'success' : 'default'"
              @click="emit('toggle-secure')"
            >
              <template #icon>
                <div
                  :class="[
                    selectedFile?.isSecure ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open',
                    'w-4 h-4',
                  ]"
                ></div>
              </template>
            </NButton>
          </template>
          {{ selectedFile?.isSecure ? "已加密 (点击解密)" : "未加密 (点击加密)" }}
        </NTooltip>
      </NButtonGroup>

      <div class="h-5 w-px" :class="isDark ? 'bg-slate-600' : 'bg-slate-300'"></div>

      <NButtonGroup size="small">
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton :quaternary="isDark" :tertiary="!isDark" @click="emit('open-search')">
              <template #icon>
                <div class="i-heroicons-magnifying-glass w-4 h-4"></div>
              </template>
            </NButton>
          </template>
          搜索 (Ctrl+P)
        </NTooltip>

        <NTooltip trigger="hover">
          <template #trigger>
            <NButton :quaternary="isDark" :tertiary="!isDark" @click="emit('toggle-theme')">
              <template #icon>
                <div :class="`${themeIcon} w-4 h-4`"></div>
              </template>
            </NButton>
          </template>
          {{ themeLabel }}模式 (点击切换)
        </NTooltip>
      </NButtonGroup>
    </div>
  </div>
</template>
