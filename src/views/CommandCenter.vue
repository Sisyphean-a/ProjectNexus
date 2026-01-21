<script setup lang="ts">
import { ref } from "vue";
import { NLayout, NLayoutSider, NLayoutContent } from "naive-ui";
import { useThemeStore } from "../stores/useThemeStore";
import Sidebar from "../components/layout/Sidebar.vue";
import ConfigList from "../components/layout/ConfigList.vue";
import EditorPane from "../components/layout/EditorPane.vue";
import GlobalSearch from "../components/GlobalSearch.vue";

const themeStore = useThemeStore();
const globalSearchRef = ref<InstanceType<typeof GlobalSearch> | null>(null);

function openSearch() {
  globalSearchRef.value?.openSearch();
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
        <EditorPane @open-search="openSearch" />
      </NLayoutContent>
    </NLayout>
  </NLayout>

  <!-- 全局搜索模态框 -->
  <GlobalSearch ref="globalSearchRef" />
</template>
