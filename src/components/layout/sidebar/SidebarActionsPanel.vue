<script setup lang="ts">
import { NButton } from "naive-ui";

defineProps<{
  hasIndex: boolean;
  isLoading: boolean;
  isDark: boolean;
  isSyncBusy: boolean;
  isSyncing: boolean;
  isForcePulling: boolean;
  isRepairing: boolean;
  apiRateLimit: { limit: number; remaining: number; resetAt: string } | null;
}>();

const emit = defineEmits<{
  initialize: [];
  "show-add-modal": [];
  "show-security-modal": [];
  "repair-shards": [];
  sync: [];
  "force-pull": [];
}>();
</script>

<template>
  <div>
    <div v-if="!hasIndex && !isLoading" class="p-4 text-center">
      <p class="text-sm text-slate-400 mb-4">未找到配置</p>
      <NButton type="primary" size="small" @click="emit('initialize')">初始化仓库</NButton>
    </div>

    <div class="p-3 border-t space-y-2 transition-colors duration-200" :class="isDark ? 'border-slate-700' : 'border-slate-200'">
      <NButton block size="small" type="primary" ghost :disabled="!hasIndex" @click="emit('show-add-modal')">
        <template #icon>
          <div class="i-heroicons-plus w-4 h-4"></div>
        </template>
        新建分类
      </NButton>

      <NButton block size="small" :quaternary="isDark" :tertiary="!isDark" @click="emit('show-security-modal')">
        <template #icon>
          <div class="i-heroicons-shield-check w-4 h-4"></div>
        </template>
        设置密码
      </NButton>

      <NButton
        block
        size="small"
        :quaternary="isDark"
        :tertiary="!isDark"
        :loading="isRepairing"
        :disabled="!hasIndex"
        @click="emit('repair-shards')"
      >
        <template #icon>
          <div class="i-heroicons-wrench-screwdriver w-4 h-4"></div>
        </template>
        修复分片
      </NButton>

      <div class="flex items-center justify-between text-xs" :class="isDark ? 'text-slate-500' : 'text-slate-400'">
        <span>{{ isSyncBusy ? "同步中..." : "已同步" }}</span>
        <div class="flex items-center gap-1">
          <NButton text size="tiny" :loading="isSyncing" :disabled="isSyncBusy && !isSyncing" title="常规同步" @click="emit('sync')">
            <template #icon>
              <div class="i-heroicons-arrow-path w-4 h-4"></div>
            </template>
          </NButton>
          <NButton
            text
            size="tiny"
            type="error"
            :loading="isForcePulling"
            :disabled="isSyncBusy && !isForcePulling"
            title="强制拉取覆盖（删除本地数据并采用远程）"
            @click="emit('force-pull')"
          >
            <template #icon>
              <div class="i-heroicons-arrow-down-tray w-4 h-4"></div>
            </template>
          </NButton>
        </div>
      </div>

      <div
        v-if="apiRateLimit && apiRateLimit.limit > 0"
        class="flex items-center justify-between text-xs pt-1 border-t border-dashed"
        :class="[
          isDark ? 'text-slate-500 border-slate-700' : 'text-slate-400 border-slate-200',
          apiRateLimit.remaining < 100 ? 'text-red-500 font-bold' : '',
        ]"
        :title="`重置时间: ${new Date(apiRateLimit.resetAt).toLocaleTimeString()}`"
      >
        <span>API 配额</span>
        <span>{{ apiRateLimit.remaining }}/{{ apiRateLimit.limit }}</span>
      </div>
    </div>
  </div>
</template>

