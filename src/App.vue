<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { darkTheme, lightTheme, type GlobalThemeOverrides, NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useAuthStore } from './stores/useAuthStore'
import { useNexusStore } from './stores/useNexusStore'
import { useThemeStore } from './stores/useThemeStore'
import Welcome from './views/Welcome.vue'
import CommandCenter from './views/CommandCenter.vue'

const authStore = useAuthStore()
const nexusStore = useNexusStore()
const themeStore = useThemeStore()

onMounted(async () => {
  await themeStore.init()
  await authStore.init()
  if (authStore.isAuthenticated) {
    await nexusStore.init()
    // 初始化后自动从远程同步最新数据
    await nexusStore.sync()
  }
})

// 深色主题配置
const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#3B82F6',
    primaryColorHover: '#60A5FA',
    primaryColorPressed: '#2563EB',
    bodyColor: '#0F172A',
    cardColor: '#1E293B',
    modalColor: '#1E293B',
    popoverColor: '#1E293B',
    tableColor: '#1E293B',
    textColorBase: '#F1F5F9',
    textColor1: '#F1F5F9',
    textColor2: '#94A3B8',
    textColor3: '#64748B',
    borderColor: '#334155',
    dividerColor: '#334155',
  },
  Layout: {
    color: '#0F172A',
    siderColor: '#0F172A',
  },
  Card: {
    color: '#1E293B',
    borderColor: '#334155',
  },
  Input: {
    color: '#1E293B',
    colorFocus: '#1E293B',
    border: '1px solid #334155',
    borderFocus: '1px solid #3B82F6',
  },
  Button: {
    colorPrimary: '#3B82F6',
    colorHoverPrimary: '#60A5FA',
    colorPressedPrimary: '#2563EB',
  },
  Menu: {
    itemColorActive: 'rgba(59, 130, 246, 0.15)',
    itemTextColorActive: '#60A5FA',
    itemIconColorActive: '#60A5FA',
  },
  List: {
    color: 'transparent',
  }
}

// 浅色主题配置
const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#2563EB',
    primaryColorHover: '#3B82F6',
    primaryColorPressed: '#1D4ED8',
    bodyColor: '#F8FAFC',
    cardColor: '#FFFFFF',
    modalColor: '#FFFFFF',
    popoverColor: '#FFFFFF',
    tableColor: '#FFFFFF',
    textColorBase: '#0F172A',
    textColor1: '#0F172A',
    textColor2: '#475569',
    textColor3: '#94A3B8',
    borderColor: '#E2E8F0',
    dividerColor: '#E2E8F0',
  },
  Layout: {
    color: '#F8FAFC',
    siderColor: '#FFFFFF',
  },
  Card: {
    color: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
  Input: {
    color: '#FFFFFF',
    colorFocus: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderFocus: '1px solid #2563EB',
  },
  Button: {
    colorPrimary: '#2563EB',
    colorHoverPrimary: '#3B82F6',
    colorPressedPrimary: '#1D4ED8',
  },
  Menu: {
    itemColorActive: 'rgba(37, 99, 235, 0.1)',
    itemTextColorActive: '#2563EB',
    itemIconColorActive: '#2563EB',
  },
  List: {
    color: 'transparent',
  }
}

const currentTheme = computed(() => themeStore.isDark ? darkTheme : lightTheme)
const currentThemeOverrides = computed(() => themeStore.isDark ? darkThemeOverrides : lightThemeOverrides)
</script>

<template>
  <NConfigProvider :theme="currentTheme" :theme-overrides="currentThemeOverrides">
    <NMessageProvider>
      <NDialogProvider>
        <div 
          class="h-screen w-screen overflow-hidden flex flex-col transition-colors duration-300"
          :class="themeStore.isDark ? 'bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-900'"
        >
          <div v-if="authStore.isChecking" class="flex-1 flex items-center justify-center">
            <div class="animate-pulse text-blue-500">Initializing Nexus...</div>
          </div>
          
          <template v-else>
            <Welcome v-if="!authStore.isAuthenticated" />
            <CommandCenter v-else-if="authStore.isAuthenticated" />
          </template>
        </div>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>
