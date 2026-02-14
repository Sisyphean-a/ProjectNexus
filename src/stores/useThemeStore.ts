import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { localStoreRepository } from '../infrastructure'

export type ThemeMode = 'dark' | 'light' | 'auto'

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>('auto')
  const systemPrefersDark = ref(true)

  // 实际应用的主题
  const effectiveTheme = computed(() => {
    if (mode.value === 'auto') {
      return systemPrefersDark.value ? 'dark' : 'light'
    }
    return mode.value
  })

  const isDark = computed(() => effectiveTheme.value === 'dark')

  // 初始化
  async function init() {
    // 从本地存储加载
    const config = await localStoreRepository.getConfig()
    if (config.theme) {
      mode.value = config.theme
    }

    // 监听系统主题变化
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      systemPrefersDark.value = mediaQuery.matches
      
      mediaQuery.addEventListener('change', (e) => {
        systemPrefersDark.value = e.matches
      })
    }
  }

  // 设置主题
  async function setMode(newMode: ThemeMode) {
    mode.value = newMode
    await localStoreRepository.saveConfig({ theme: newMode })
  }

  // 循环切换主题
  async function toggleTheme() {
    const modes: ThemeMode[] = ['light', 'dark', 'auto']
    const currentIndex = modes.indexOf(mode.value)
    const nextIndex = (currentIndex + 1) % modes.length
    await setMode(modes[nextIndex])
  }

  // 监听 isDark 变化，自动切换 html class
  // 这样可以使用 UnoCSS 的 dark: 变体
  watch(isDark, (dark) => {
    if (typeof document !== 'undefined') {
      if (dark) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }
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
