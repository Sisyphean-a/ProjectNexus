<script setup lang="ts">
import { NButton, NInput, NModal, NSpace, NSelect } from "naive-ui";
import { languageOptions } from "../../../constants/languages";

defineProps<{
  show: boolean;
  title: string;
  name: string;
  defaultLanguage: string;
  confirmText: string;
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  "update:name": [value: string];
  "update:defaultLanguage": [value: string];
  confirm: [];
}>();
</script>

<template>
  <NModal :show="show" preset="dialog" :title="title" @update:show="emit('update:show', $event)">
    <div class="space-y-4">
      <NInput :value="name" placeholder="输入分类名称" @update:value="emit('update:name', $event)" @keydown.enter="emit('confirm')" />
      <NSelect
        :value="defaultLanguage"
        :options="languageOptions"
        placeholder="选择默认语言"
        @update:value="emit('update:defaultLanguage', $event)"
      />
    </div>
    <template #action>
      <NSpace>
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="isLoading" @click="emit('confirm')">{{ confirmText }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

