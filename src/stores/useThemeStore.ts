import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { appContainer } from '../bootstrap/container'

export type ThemeMode = 'dark' | 'light' | 'auto'

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>('auto')
  const systemPrefersDark = ref(true)

  const effectiveTheme = computed(() => {
    if (mode.value === 'auto') {
      return systemPrefersDark.value ? 'dark' : 'light'
    }
    return mode.value
  })

  const isDark = computed(() => effectiveTheme.value === 'dark')

  async function init() {
    const config = await appContainer.localStoreRepository.getConfig()
    if (config.theme) {
      mode.value = config.theme
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      systemPrefersDark.value = mediaQuery.matches
      mediaQuery.addEventListener('change', (event) => {
        systemPrefersDark.value = event.matches
      })
    }
  }

  async function setMode(newMode: ThemeMode) {
    mode.value = newMode
    await appContainer.localStoreRepository.saveConfig({ theme: newMode })
  }

  async function toggleTheme() {
    const modes: ThemeMode[] = ['light', 'dark', 'auto']
    const currentIndex = modes.indexOf(mode.value)
    const nextIndex = (currentIndex + 1) % modes.length
    await setMode(modes[nextIndex])
  }

  watch(isDark, (dark) => {
    if (typeof document === 'undefined') {
      return
    }

    if (dark) {
      document.documentElement.classList.add('dark')
      return
    }

    document.documentElement.classList.remove('dark')
  }, { immediate: true })

  return {
    mode,
    effectiveTheme,
    isDark,
    init,
    setMode,
    toggleTheme
  }
})
