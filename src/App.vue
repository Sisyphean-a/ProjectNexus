<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { darkTheme, lightTheme, type GlobalThemeOverrides, NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useAuthStore } from './stores/useAuthStore'
import { useNexusStore } from './stores/useNexusStore'
import { useThemeStore } from './stores/useThemeStore'
import Welcome from './views/Welcome.vue'
import CommandCenter from './views/CommandCenter.vue'

const STARTUP_SYNC_DELAY_MS = 3000
const STARTUP_SYNC_STALE_MS = 5 * 60 * 1000

const authStore = useAuthStore()
const nexusStore = useNexusStore()
const themeStore = useThemeStore()
const startupSyncState = ref<'idle' | 'scheduled' | 'running' | 'failed'>('idle')
const hasBootstrappedNexus = ref(false)
let startupSyncTimer: ReturnType<typeof setTimeout> | null = null

function clearStartupSyncTimer() {
  if (startupSyncTimer) {
    clearTimeout(startupSyncTimer)
    startupSyncTimer = null
  }
}

function scheduleStartupSync() {
  if (!authStore.isAuthenticated) {
    return
  }

  clearStartupSyncTimer()
  startupSyncState.value = 'scheduled'

  startupSyncTimer = setTimeout(async () => {
    startupSyncState.value = 'running'
    try {
      await nexusStore.syncIfStale(STARTUP_SYNC_STALE_MS)
      startupSyncState.value = 'idle'
    } catch (e) {
      console.error('[App] Startup sync failed', e)
      startupSyncState.value = 'failed'
    }
  }, STARTUP_SYNC_DELAY_MS)
}

async function bootstrapNexusForSession() {
  if (!authStore.isAuthenticated || hasBootstrappedNexus.value) {
    return
  }

  hasBootstrappedNexus.value = true
  try {
    await nexusStore.init()
    scheduleStartupSync()
    void authStore.verifyTokenInBackground().catch((e) => {
      console.error('[App] Background token verification failed', e)
    })
  } catch (e) {
    hasBootstrappedNexus.value = false
    throw e
  }
}

const showStartupStatus = computed(() => {
  if (!authStore.isAuthenticated) {
    return false
  }
  return startupSyncState.value !== 'idle' || authStore.tokenStatus === 'unknown'
})

const startupStatusText = computed(() => {
  if (startupSyncState.value === 'failed') {
    return '后台同步失败，可稍后手动重试'
  }
  if (startupSyncState.value === 'running') {
    return '正在后台同步远程数据...'
  }
  if (startupSyncState.value === 'scheduled') {
    return '已加载本地缓存，稍后自动同步...'
  }
  if (authStore.tokenStatus === 'unknown') {
    return '正在后台校验身份凭据...'
  }
  return ''
})

const startupStatusClass = computed(() => {
  if (startupSyncState.value === 'failed') {
    return 'border-amber-300/60 bg-amber-50/95 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200'
  }

  return 'border-slate-200/80 bg-white/95 text-slate-600 dark:border-slate-700/80 dark:bg-slate-900/85 dark:text-slate-300'
})

onMounted(async () => {
  await Promise.all([themeStore.init(), authStore.init()])

  try {
    await bootstrapNexusForSession()
  } catch (e) {
    console.error('[App] Bootstrap failed', e)
  }
})

watch(
  () => authStore.isAuthenticated,
  async (authed) => {
    if (authed) {
      try {
        await bootstrapNexusForSession()
      } catch (e) {
        console.error('[App] Session bootstrap failed', e)
      }
      return
    }

    clearStartupSyncTimer()
    startupSyncState.value = 'idle'
    hasBootstrappedNexus.value = false
  },
)

onBeforeUnmount(() => {
  clearStartupSyncTimer()
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
          class="h-screen w-screen overflow-hidden flex flex-col transition-colors duration-300 bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100"
        >
          <div v-if="!authStore.authBootstrapDone" class="flex-1 flex items-center justify-center">
            <div class="animate-pulse text-blue-500">Recovering local session...</div>
          </div>
          
          <template v-else>
            <div class="flex-1 min-h-0">
              <Welcome v-if="!authStore.isAuthenticated" />
              <CommandCenter v-else-if="authStore.isAuthenticated" />
            </div>

            <Transition
              enter-active-class="transition duration-250 ease-out"
              leave-active-class="transition duration-200 ease-in"
              enter-from-class="opacity-0 translate-y-3"
              leave-to-class="opacity-0 translate-y-2"
            >
              <div
                v-if="showStartupStatus"
                class="fixed bottom-4 right-4 z-50 max-w-xs border rounded-lg shadow-lg px-3 py-2 text-xs leading-5 backdrop-blur pointer-events-none"
                :class="startupStatusClass"
                role="status"
                aria-live="polite"
              >
                {{ startupStatusText }}
              </div>
            </Transition>
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
