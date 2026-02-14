import { defineStore } from 'pinia'
import { ref } from 'vue'
import { gistRepository, localStoreRepository } from '../infrastructure'

type TokenStatus = 'unknown' | 'valid' | 'invalid'

export const TOKEN_VERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000

function parseIsoTime(value: string | null | undefined): number {
  if (!value) {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref('')
  const isAuthenticated = ref(false)
  const isChecking = ref(true)
  const authBootstrapDone = ref(false)
  const tokenStatus = ref<TokenStatus>('unknown')
  const tokenVerifiedAt = ref<string | null>(null)

  let verificationPromise: Promise<void> | null = null

  function shouldVerify(force = false): boolean {
    if (force) {
      return true
    }
    if (!token.value) {
      return false
    }

    const lastVerifiedMs = parseIsoTime(tokenVerifiedAt.value)
    if (!lastVerifiedMs) {
      return true
    }
    return Date.now() - lastVerifiedMs >= TOKEN_VERIFY_INTERVAL_MS
  }

  async function init() {
    isChecking.value = true
    try {
      const config = await localStoreRepository.getConfig()

      token.value = config.githubToken || ''
      tokenVerifiedAt.value = config.tokenVerifiedAt || null

      if (token.value) {
        gistRepository.setAuthToken(token.value)
        isAuthenticated.value = true
        tokenStatus.value = 'unknown'
      } else {
        gistRepository.setAuthToken(null)
        isAuthenticated.value = false
        tokenStatus.value = 'invalid'
      }
    } finally {
      authBootstrapDone.value = true
      isChecking.value = false
    }
  }

  async function verifyTokenInBackground(force = false): Promise<void> {
    if (!token.value) {
      gistRepository.setAuthToken(null)
      isAuthenticated.value = false
      tokenStatus.value = 'invalid'
      tokenVerifiedAt.value = null
      return
    }

    if (!shouldVerify(force)) {
      isAuthenticated.value = true
      tokenStatus.value = 'valid'
      return
    }

    if (verificationPromise) {
      return verificationPromise
    }

    const tokenSnapshot = token.value
    verificationPromise = (async () => {
      try {
        const valid = await gistRepository.verifyToken(tokenSnapshot)

        if (token.value !== tokenSnapshot) {
          return
        }

        if (valid) {
          isAuthenticated.value = true
          tokenStatus.value = 'valid'

          const verifiedAt = new Date().toISOString()
          tokenVerifiedAt.value = verifiedAt
          await localStoreRepository.saveConfig({
            githubToken: tokenSnapshot,
            tokenVerifiedAt: verifiedAt,
          })
          return
        }

        token.value = ''
        gistRepository.setAuthToken(null)
        isAuthenticated.value = false
        tokenStatus.value = 'invalid'
        tokenVerifiedAt.value = null
        await localStoreRepository.saveConfig({
          githubToken: '',
          tokenVerifiedAt: null,
        })
      } catch (e) {
        console.warn('[Auth] Background token verification failed', e)
      } finally {
        verificationPromise = null
      }
    })()

    return verificationPromise
  }

  async function setToken(newToken: string): Promise<boolean> {
    isChecking.value = true
    try {
      const valid = await gistRepository.verifyToken(newToken)
      if (valid) {
        token.value = newToken
        gistRepository.setAuthToken(newToken)
        isAuthenticated.value = true
        tokenStatus.value = 'valid'
        const verifiedAt = new Date().toISOString()
        tokenVerifiedAt.value = verifiedAt
        await localStoreRepository.saveConfig({
          githubToken: newToken,
          tokenVerifiedAt: verifiedAt,
        })
      } else {
        token.value = ''
        gistRepository.setAuthToken(null)
        isAuthenticated.value = false
        tokenStatus.value = 'invalid'
        tokenVerifiedAt.value = null
      }
      return valid
    } finally {
      isChecking.value = false
    }
  }

  function logout() {
    token.value = ''
    gistRepository.setAuthToken(null)
    isAuthenticated.value = false
    tokenStatus.value = 'invalid'
    tokenVerifiedAt.value = null
    localStoreRepository.saveConfig({
      githubToken: '',
      tokenVerifiedAt: null,
    })
  }

  return {
    token,
    isAuthenticated,
    isChecking,
    authBootstrapDone,
    tokenStatus,
    tokenVerifiedAt,
    init,
    setToken,
    verifyTokenInBackground,
    logout
  }
})
