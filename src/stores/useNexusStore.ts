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

  // ========== 索引保存 ==========
  async function saveIndex() {
    if (!index.value || !currentGistId.value) return
    index.value.updated_at = new Date().toISOString()
    await gistRepository.updateGistFile(
      currentGistId.value,
      'nexus_index.json',
      JSON.stringify(index.value, null, 2)
    )
    await localStoreRepository.saveIndex(index.value)
  }

  // ========== 分类 CRUD ==========
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
  }

  async function addCategory(name: string, icon = 'folder') {
    if (!index.value) return
    const newCategory = {
      id: generateId(),
      name,
      icon,
      items: []
    }
    index.value.categories.push(newCategory)
    await saveIndex()
    selectedCategoryId.value = newCategory.id
    return newCategory
  }

  async function updateCategory(id: string, updates: { name?: string; icon?: string }) {
    if (!index.value) return
    const cat = index.value.categories.find(c => c.id === id)
    if (cat) {
      if (updates.name) cat.name = updates.name
      if (updates.icon) cat.icon = updates.icon
      await saveIndex()
    }
  }

  async function deleteCategory(id: string) {
    if (!index.value || !currentGistId.value) return
    const catIndex = index.value.categories.findIndex(c => c.id === id)
    if (catIndex === -1) return

    const category = index.value.categories[catIndex]
    // 删除该分类下所有文件（从 Gist）
    for (const item of category.items) {
      await gistRepository.updateGistFile(currentGistId.value, item.gist_file, null)
    }

    index.value.categories.splice(catIndex, 1)
    await saveIndex()

    // 重置选择
    if (selectedCategoryId.value === id) {
      selectedCategoryId.value = index.value.categories[0]?.id || null
      selectedFileId.value = null
    }
  }

  // ========== 文件 CRUD ==========
  async function addFile(categoryId: string, title: string, initialContent = '') {
    if (!index.value || !currentGistId.value) return null

    const cat = index.value.categories.find(c => c.id === categoryId)
    if (!cat) return null

    const fileId = generateId()
    const filename = `${fileId}.yaml` // 默认扩展名

    const newItem = {
      id: fileId,
      title,
      gist_file: filename,
      tags: [] as string[]
    }

    // 先在 Gist 创建文件
    await gistRepository.updateGistFile(currentGistId.value, filename, initialContent || `# ${title}\n`)

    cat.items.push(newItem)
    await saveIndex()

    selectedFileId.value = fileId
    return newItem
  }

  async function updateFile(fileId: string, updates: { title?: string; tags?: string[] }) {
    if (!index.value) return
    for (const cat of index.value.categories) {
      const file = cat.items.find(f => f.id === fileId)
      if (file) {
        if (updates.title !== undefined) file.title = updates.title
        if (updates.tags !== undefined) file.tags = updates.tags
        await saveIndex()
        return
      }
    }
  }

  async function deleteFile(categoryId: string, fileId: string) {
    if (!index.value || !currentGistId.value) return

    const cat = index.value.categories.find(c => c.id === categoryId)
    if (!cat) return

    const fileIndex = cat.items.findIndex(f => f.id === fileId)
    if (fileIndex === -1) return

    const file = cat.items[fileIndex]
    // 从 Gist 删除
    await gistRepository.updateGistFile(currentGistId.value, file.gist_file, null)

    cat.items.splice(fileIndex, 1)
    await saveIndex()

    if (selectedFileId.value === fileId) {
      selectedFileId.value = null
    }
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
    updateConfig,
    saveIndex,
    addCategory,
    updateCategory,
    deleteCategory,
    addFile,
    updateFile,
    deleteFile
  }
})
