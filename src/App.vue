<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { darkTheme, type GlobalThemeOverrides, NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useAuthStore } from './stores/useAuthStore'
import { useNexusStore } from './stores/useNexusStore'
import Welcome from './views/Welcome.vue'
import CommandCenter from './views/CommandCenter.vue'

const authStore = useAuthStore()
const nexusStore = useNexusStore()

onMounted(async () => {
  await authStore.init()
  if (authStore.isAuthenticated) {
    await nexusStore.init()
    if (nexusStore.config?.gistId) {
        // Explicitly sync if we have a Gist ID to ensure freshness?
        // Or just rely on local cache first. Local first.
        // nexusStore.sync() 
    }
  }
})

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#3B82F6',
    primaryColorHover: '#2563EB',
    primaryColorPressed: '#1D4ED8',
    bodyColor: '#0F172A',
    cardColor: '#1E293B',
    textColorBase: '#F1F5F9',
    textColor1: '#F1F5F9',
    textColor2: '#94A3B8',
  },
  Layout: {
    color: '#0F172A',
    siderColor: '#0F172A', // Sidebar background
  },
  Card: {
    color: '#1E293B',
  }
}

</script>

<template>
  <NConfigProvider :theme="darkTheme" :theme-overrides="themeOverrides">
    <NMessageProvider>
      <NDialogProvider>
        <div class="h-screen w-screen bg-slate-900 text-slate-100 overflow-hidden flex flex-col">
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
/* Global resets or overrides if needed */
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>
