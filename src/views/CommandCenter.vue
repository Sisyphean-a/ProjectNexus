<script setup lang="ts">
import { ref } from "vue";
import {
  NLayout,
  NLayoutSider,
  NLayoutContent,
  NButton,
  NTooltip,
} from "naive-ui";
import { useNexusStore } from "../stores/useNexusStore";
import { useThemeStore } from "../stores/useThemeStore";
import Sidebar from "../components/layout/Sidebar.vue";
import ConfigList from "../components/layout/ConfigList.vue";
import EditorPane from "../components/layout/EditorPane.vue";
import GlobalSearch from "../components/GlobalSearch.vue";

const nexusStore = useNexusStore();
const themeStore = useThemeStore();
const globalSearchRef = ref<InstanceType<typeof GlobalSearch> | null>(null);

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
      :style="{
        backgroundColor: themeStore.isDark
          ? 'rgba(15, 23, 42, 0.95)'
          : 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
      }"
    >
      <Sidebar />
    </NLayoutSider>

    <!-- 主内容区 -->
    <NLayout has-sider class="flex-1">
      <!-- 配置列表 -->
      <NLayoutSider
        width="280"
        bordered
        :style="{
          backgroundColor: themeStore.isDark
            ? 'rgba(30, 41, 59, 0.8)'
            : 'rgba(248, 250, 252, 0.9)',
          backdropFilter: 'blur(8px)',
        }"
      >
        <ConfigList />
      </NLayoutSider>

      <!-- 编辑器区域 -->
      <NLayoutContent :class="themeStore.isDark ? 'bg-slate-900' : 'bg-white'">
        <EditorPane />
      </NLayoutContent>
    </NLayout>

    <!-- 顶部工具栏（浮动） -->
    <div
      class="fixed top-3 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-xl shadow-lg backdrop-blur-md transition-colors duration-200"
      :class="
        themeStore.isDark
          ? 'bg-slate-800/80 border border-slate-700/50'
          : 'bg-white/80 border border-slate-200'
      "
    >
      <!-- 搜索按钮 -->
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton
            circle
            size="small"
            :quaternary="themeStore.isDark"
            :tertiary="!themeStore.isDark"
            @click="globalSearchRef?.openSearch()"
          >
            <template #icon>
              <div class="i-heroicons-magnifying-glass w-4 h-4"></div>
            </template>
          </NButton>
        </template>
        搜索 (Ctrl+P)
      </NTooltip>

      <!-- 分隔符 -->
      <div
        class="h-5 w-px"
        :class="themeStore.isDark ? 'bg-slate-600' : 'bg-slate-300'"
      ></div>

      <!-- 主题切换按钮 -->
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton
            circle
            size="small"
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
    </div>
  </NLayout>

  <!-- 全局搜索模态框 -->
  <GlobalSearch ref="globalSearchRef" />
</template>
