import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { gistRepository, localStoreRepository } from '../infrastructure'
import type { NexusIndex, NexusConfig } from '../core/domain/types'
import { useAuthStore } from './useAuthStore'

export const useNexusStore = defineStore('nexus', () => {
  const authStore = useAuthStore()
  
  const config = ref<NexusConfig | null>(null)
  const index = ref<NexusIndex | null>(null)
  const isLoading = ref(false)
  
  // Current Gist ID being used
  const currentGistId = computed(() => config.value?.gistId)

  // Selection State
  const selectedCategoryId = ref<string | null>(null)
  const selectedFileId = ref<string | null>(null)

  const currentCategory = computed(() => {
    if (!index.value || !selectedCategoryId.value) return null
    return index.value.categories.find(c => c.id === selectedCategoryId.value) || null
  })

  // List of files in current category
  const currentFileList = computed(() => {
    return currentCategory.value?.items || []
  })

  async function init() {
    config.value = await localStoreRepository.getConfig()
    
    // Attempt to load local index
    index.value = await localStoreRepository.getIndex()
  }

  async function sync() {
    if (!authStore.isAuthenticated) return
    isLoading.value = true
    
    try {
        let gistId = config.value?.gistId

        // If no Gist ID known, try to find it
        if (!gistId) {
            gistId = await gistRepository.findNexusGist()
            if (gistId) {
                // Found existing gist, save ID
                await updateConfig({ gistId })
            } else {
                // Determine if we should create one? 
                // For now, if not found, we just wait for user action or auto-create empty?
                // Let's auto-create if not found to simplify flow, 
                // OR better, let UI trigger creation ("Initialize Nexus").
                // Returning early here if not found.
                isLoading.value = false
                return 'no_gist'
            }
        }
        
        // Fetch Gist content to get Index
        if (gistId) {
            const files = await gistRepository.getGistContent(gistId)
            const indexFile = files['nexus_index.json']
            if (indexFile) {
                const remoteIndex = JSON.parse(indexFile.content) as NexusIndex
                // TODO: Conflict resolution. For now, Remote Wins or Merge?
                // Simple: Remote Wins for index.
                index.value = remoteIndex
                await localStoreRepository.saveIndex(remoteIndex)
            }
        }
        
    } catch (e) {
        console.error('Sync failed', e)
    } finally {
        isLoading.value = false
    }
  }

  async function initializeGist() {
    if (!authStore.isAuthenticated) return
    isLoading.value = true
    try {
        const initialIndex: NexusIndex = {
            updated_at: new Date().toISOString(),
            categories: [
                {
                    id: 'default',
                    name: 'General',
                    icon: 'folder',
                    items: []
                }
            ]
        }
        const newGistId = await gistRepository.createNexusGist(initialIndex)
        await updateConfig({ gistId: newGistId })
        index.value = initialIndex
        await localStoreRepository.saveIndex(initialIndex)
        
        // Select default
        selectedCategoryId.value = 'default'

    } catch (e) {
        console.error('Failed to initialize Nexus Gist', e)
        throw e
    } finally {
        isLoading.value = false
    }
  }

  async function updateConfig(updates: Partial<NexusConfig>) {
    await localStoreRepository.saveConfig(updates)
    config.value = { ...config.value!, ...updates }
  }

  return {
    config,
    index,
    isLoading,
    currentGistId,
    selectedCategoryId,
    selectedFileId,
    currentCategory,
    currentFileList,
    init,
    sync,
    initializeGist,
    updateConfig
  }
})
