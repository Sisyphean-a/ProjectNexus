import { defineStore } from 'pinia'
import { ref } from 'vue'
import { gistRepository, localStoreRepository } from '../infrastructure'

export const useAuthStore = defineStore('auth', () => {
  const token = ref('')
  const isAuthenticated = ref(false)
  const isChecking = ref(true)

  async function init() {
    isChecking.value = true
    const config = await localStoreRepository.getConfig()
    if (config.githubToken) {
      const valid = await gistRepository.verifyToken(config.githubToken)
      if (valid) {
        token.value = config.githubToken
        isAuthenticated.value = true
      } else {
        // Token invalid or expired
        isAuthenticated.value = false
      }
    }
    isChecking.value = false
  }

  async function setToken(newToken: string): Promise<boolean> {
    isChecking.value = true
    const valid = await gistRepository.verifyToken(newToken)
    if (valid) {
      token.value = newToken
      isAuthenticated.value = true
      await localStoreRepository.saveConfig({ githubToken: newToken })
    } else {
        isAuthenticated.value = false
    }
    isChecking.value = false
    return valid
  }

  function logout() {
    token.value = ''
    isAuthenticated.value = false
    localStoreRepository.saveConfig({ githubToken: '' })
  }

  return {
    token,
    isAuthenticated,
    isChecking,
    init,
    setToken,
    logout
  }
})
