<script setup lang="ts">
import { ref } from 'vue'
import { NLayout, NLayoutSider, NLayoutContent, NButton, NTooltip } from 'naive-ui'
import { useNexusStore } from '../stores/useNexusStore'
import { useThemeStore } from '../stores/useThemeStore'
import Sidebar from '../components/layout/Sidebar.vue'
import ConfigList from '../components/layout/ConfigList.vue'
import EditorPane from '../components/layout/EditorPane.vue'
import GlobalSearch from '../components/GlobalSearch.vue'

const nexusStore = useNexusStore()
const themeStore = useThemeStore()
const globalSearchRef = ref<InstanceType<typeof GlobalSearch> | null>(null)

// 主题图标
function getThemeIcon() {
  if (themeStore.mode === 'dark') return 'i-heroicons-moon'
  if (themeStore.mode === 'light') return 'i-heroicons-sun'
  return 'i-heroicons-computer-desktop'
}

function getThemeLabel() {
  if (themeStore.mode === 'dark') return '深色'
  if (themeStore.mode === 'light') return '浅色'
  return '自动'
}
</script>

<template>
  <NLayout has-sider class="h-full">
    <!-- 侧边栏 (分类) -->
    <NLayoutSider
      width="220"
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      show-trigger
      :class="themeStore.isDark ? 'bg-slate-900/95 backdrop-blur' : 'bg-white/95 backdrop-blur'"
    >
      <Sidebar />
    </NLayoutSider>

    <!-- 主内容区 -->
    <NLayout has-sider class="flex-1">
      <!-- 配置列表 -->
      <NLayoutSider
        width="280"
        bordered
        :class="themeStore.isDark ? 'bg-slate-800/80 backdrop-blur' : 'bg-slate-50/80 backdrop-blur'"
      >
        <ConfigList />
      </NLayoutSider>
      
      <!-- 编辑器区域 -->
      <NLayoutContent :class="themeStore.isDark ? 'bg-slate-900' : 'bg-white'">
        <EditorPane />
      </NLayoutContent>
    </NLayout>

    <!-- 顶部工具栏（浮动） -->
    <div class="fixed top-3 right-4 z-50 flex items-center space-x-2">
      <!-- 搜索按钮 -->
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton
            circle
            :quaternary="themeStore.isDark"
            :tertiary="!themeStore.isDark"
            @click="globalSearchRef?.openSearch()"
          >
            <template #icon>
              <div class="i-heroicons-magnifying-glass w-5 h-5"></div>
            </template>
          </NButton>
        </template>
        搜索 (Ctrl+P)
      </NTooltip>
      
      <!-- 主题切换按钮 -->
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton
            circle
            :quaternary="themeStore.isDark"
            :tertiary="!themeStore.isDark"
            @click="themeStore.toggleTheme()"
          >
            <template #icon>
              <div :class="`${getThemeIcon()} w-5 h-5`"></div>
            </template>
          </NButton>
        </template>
        {{ getThemeLabel() }}模式 (点击切换)
      </NTooltip>
    </div>
  </NLayout>
  
  <!-- 全局搜索模态框 -->
  <GlobalSearch ref="globalSearchRef" />
</template>
