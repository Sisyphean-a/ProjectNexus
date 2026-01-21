<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../stores/useAuthStore'
import { NCard, NInput, NButton, useMessage } from 'naive-ui'

const authStore = useAuthStore()
const tokenInput = ref('')
const loading = ref(false)
const message = useMessage()

async function handleLogin() {
  if (!tokenInput.value) return
  loading.value = true
  
  const success = await authStore.setToken(tokenInput.value)
  if (!success) {
    message.error('Invalid GitHub Token. Please check your permissions (gist).')
  } else {
    message.success('Connected to Nexus.')
  }
  
  loading.value = false
}
</script>

<template>
  <div class="flex-1 flex flex-col items-center justify-center p-8 bg-gradient-to-br from-slate-900 to-slate-800">
    <div class="mb-8 text-center">
      <h1 class="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400 mb-2">
        Project Nexus
      </h1>
      <p class="text-slate-400 text-lg">Your digital second brain, synced in silence.</p>
    </div>

    <NCard class="max-w-md w-full shadow-2xl border-slate-700" size="large">
      <div class="space-y-6">
        <div>
            <label class="block text-sm font-medium text-slate-300 mb-2">GitHub Personal Access Token</label>
            <NInput 
              v-model:value="tokenInput" 
              placeholder="ghp_xxxxxxxxxxxx" 
              type="password" 
              show-password-on="click"
              @keydown.enter="handleLogin"
            />
            <p class="text-xs text-slate-500 mt-2">
              Requires <code>gist</code> permission. 
              Token is stored locally and encrypted.
            </p>
        </div>
        
        <NButton type="primary" block size="large" :loading="loading" @click="handleLogin">
          Connect Vault
        </NButton>
      </div>
    </NCard>
  </div>
</template>
