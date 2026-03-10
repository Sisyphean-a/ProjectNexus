<script setup lang="ts">
import { NButton, NInput, NModal, NSpace, NSelect } from "naive-ui";

defineProps<{
  show: boolean;
  password: string;
  rememberMode: string;
  rememberModeOptions: Array<{ label: string; value: string }>;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  "update:password": [value: string];
  "update:rememberMode": [value: string];
  save: [];
}>();
</script>

<template>
  <NModal :show="show" preset="dialog" title="设置保险库密码" @update:show="emit('update:show', $event)">
    <div class="space-y-4">
      <p class="text-xs text-gray-500">
        此密码用于加密/解密标记为“安全”的文件。默认仅保留在当前运行内存，
        不写入本地持久化存储。
      </p>
      <NInput
        :value="password"
        type="password"
        placeholder="输入新的保险库密码"
        show-password-on="click"
        @update:value="emit('update:password', $event)"
        @keydown.enter="emit('save')"
      />
      <div class="space-y-1 text-xs">
        <span>密码记住策略</span>
        <NSelect
          size="small"
          :value="rememberMode"
          :options="rememberModeOptions"
          @update:value="emit('update:rememberMode', $event)"
        />
      </div>
    </div>
    <template #action>
      <NSpace>
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" @click="emit('save')">保存</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

