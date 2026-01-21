<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../stores/useAuthStore'
import { useThemeStore } from '../stores/useThemeStore'
import { NCard, NInput, NButton, useMessage } from 'naive-ui'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const tokenInput = ref('')
const loading = ref(false)
const message = useMessage()

async function handleLogin() {
  if (!tokenInput.value) return
  loading.value = true
  
  const success = await authStore.setToken(tokenInput.value)
  if (!success) {
    message.error('无效的 GitHub Token。请检查权限是否包含 gist。')
  } else {
    message.success('已连接到 Nexus。')
  }
  
  loading.value = false
}
</script>

<template>
  <div 
    class="flex-1 flex flex-col items-center justify-center p-8 transition-colors duration-300"
    :class="themeStore.isDark 
      ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900' 
      : 'bg-gradient-to-br from-blue-50 via-white to-slate-50'"
  >
    <!-- Logo 和标语 -->
    <div class="mb-10 text-center">
      <div class="flex items-center justify-center mb-4">
        <div class="i-heroicons-cube-transparent w-16 h-16 text-blue-500"></div>
      </div>
      <h1 
        class="text-5xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-emerald-500"
      >
        Project Nexus
      </h1>
      <p :class="themeStore.isDark ? 'text-slate-400' : 'text-slate-600'" class="text-lg">
        你的数字第二大脑，静默同步，全屏掌控
      </p>
    </div>

    <!-- 登录卡片 -->
    <NCard 
      class="max-w-md w-full shadow-2xl"
      :class="themeStore.isDark ? 'border-slate-700' : 'border-slate-200'"
      size="large"
    >
      <div class="space-y-6">
        <div>
          <label 
            class="block text-sm font-medium mb-2"
            :class="themeStore.isDark ? 'text-slate-300' : 'text-slate-700'"
          >
            GitHub Personal Access Token
          </label>
          <NInput 
            v-model:value="tokenInput" 
            placeholder="ghp_xxxxxxxxxxxx" 
            type="password" 
            show-password-on="click"
            size="large"
            @keydown.enter="handleLogin"
          />
          <p 
            class="text-xs mt-2"
            :class="themeStore.isDark ? 'text-slate-500' : 'text-slate-400'"
          >
            需要 <code class="px-1 py-0.5 rounded bg-slate-700/30">gist</code> 权限。
            Token 仅存储在本地，绝不上传。
          </p>
        </div>
        
        <NButton 
          type="primary" 
          block 
          size="large" 
          :loading="loading" 
          @click="handleLogin"
        >
          连接仓库
        </NButton>

        <!-- 帮助链接 -->
        <div class="text-center">
          <a 
            href="https://github.com/settings/tokens/new?scopes=gist&description=Nexus%20Configuration" 
            target="_blank"
            class="text-sm text-blue-500 hover:text-blue-400 transition-colors"
          >
            如何创建 GitHub Token →
          </a>
        </div>
      </div>
    </NCard>

    <!-- 主题切换 -->
    <div class="mt-8">
      <NButton 
        quaternary 
        size="small" 
        @click="themeStore.toggleTheme()"
      >
        <template #icon>
          <div :class="themeStore.isDark ? 'i-heroicons-sun' : 'i-heroicons-moon'" class="w-4 h-4"></div>
        </template>
        {{ themeStore.isDark ? '切换到浅色模式' : '切换到深色模式' }}
      </NButton>
    </div>
  </div>
</template>
