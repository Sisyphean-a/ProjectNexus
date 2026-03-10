import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  authFacade,
} from '../bootstrap/container'
import type {
  AuthSessionSnapshot,
  TokenStatus,
} from '../core/application/facades/AuthFacade'
import { createSignedOutAuthState } from '../core/application/facades/AuthFacade'

export const useAuthStore = defineStore('auth', () => {
  const token = ref('')
  const isAuthenticated = ref(false)
  const isChecking = ref(true)
  const authBootstrapDone = ref(false)
  const tokenStatus = ref<TokenStatus>('unknown')
  const tokenVerifiedAt = ref<string | null>(null)

  let verificationPromise: Promise<void> | null = null

  function applySnapshot(snapshot: AuthSessionSnapshot) {
    token.value = snapshot.token
    isAuthenticated.value = snapshot.isAuthenticated
    tokenStatus.value = snapshot.tokenStatus
    tokenVerifiedAt.value = snapshot.tokenVerifiedAt
  }

  async function init() {
    isChecking.value = true
    try {
      const snapshot = await authFacade.restoreSession()
      applySnapshot(snapshot)
    } finally {
      authBootstrapDone.value = true
      isChecking.value = false
    }
  }

  async function verifyTokenInBackground(force = false): Promise<void> {
    if (verificationPromise) {
      return verificationPromise
    }

    const tokenSnapshot = token.value
    const verifiedAtSnapshot = tokenVerifiedAt.value
    verificationPromise = (async () => {
      try {
        const restoreCurrentClientToken = () => {
          authFacade.syncClientToken(token.value || null)
        }

        if (token.value !== tokenSnapshot) {
          return
        }

        const snapshot = await authFacade.verifyToken({
          token: tokenSnapshot,
          tokenVerifiedAt: verifiedAtSnapshot,
        }, {
          force,
          shouldCommit: () => token.value === tokenSnapshot,
          onStaleResult: restoreCurrentClientToken,
        })

        if (token.value !== tokenSnapshot) {
          return
        }

        applySnapshot(snapshot)
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
      const result = await authFacade.setToken(newToken)
      if (result.ok) {
        applySnapshot(result.data)
      } else {
        applySnapshot(createSignedOutAuthState())
      }
      return result.ok
    } finally {
      isChecking.value = false
    }
  }

  function logout() {
    applySnapshot(createSignedOutAuthState())
    void authFacade.logout().catch((e) => {
      console.warn('[Auth] Logout persistence failed', e)
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
