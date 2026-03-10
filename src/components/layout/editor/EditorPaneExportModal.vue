<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { NButton, NInput, NModal } from "naive-ui";

const props = defineProps<{
  show: boolean;
  baseName: string;
  extension: string;
  isExporting: boolean;
  isDark: boolean;
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  "update:baseName": [value: string];
  "update:extension": [value: string];
  confirm: [];
}>();

const inputRef = ref<InstanceType<typeof NInput> | null>(null);

watch(
  () => props.show,
  async (show) => {
    if (!show) {
      return;
    }
    await nextTick();
    inputRef.value?.focus();
  },
);

function handleKeyDown(event: KeyboardEvent) {
  if (!props.show || event.isComposing || event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  emit("confirm");
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="导出为文件"
    size="small"
    style="width: 420px; max-width: 90vw"
    :mask-closable="false"
    @update:show="emit('update:show', $event)"
    @keydown="handleKeyDown"
  >
    <div class="space-y-3">
      <div class="space-y-1">
        <div class="text-xs" :class="isDark ? 'text-slate-400' : 'text-slate-500'">文件名称</div>
        <NInput ref="inputRef" :value="baseName" placeholder="请输入文件名称" @update:value="emit('update:baseName', $event)" />
      </div>

      <div class="space-y-1">
        <div class="text-xs" :class="isDark ? 'text-slate-400' : 'text-slate-500'">类型（后缀）</div>
        <NInput :value="extension" placeholder="例如 json / yaml / txt" @update:value="emit('update:extension', $event)" />
      </div>

      <div class="text-xs" :class="isDark ? 'text-slate-500' : 'text-slate-400'">提示：按 Enter 可直接确认导出</div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="isExporting" @click="emit('confirm')">确认导出</NButton>
      </div>
    </template>
  </NModal>
</template>
