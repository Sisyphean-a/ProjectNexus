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
  
  // 同步状态追踪
  const lastSyncedAt = ref<string | null>(null)      // 上次成功同步的时间
  const remoteUpdatedAt = ref<string | null>(null)   // 远程索引的 updated_at
  
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
    if (!authStore.isAuthenticated) {
      throw new Error('未认证')
    }
    isLoading.value = true
    
    try {
        let gistId = config.value?.gistId

        // 如果本地没有 gistId，尝试从 GitHub 查找
        if (!gistId) {
            gistId = await gistRepository.findNexusGist()
            if (gistId) {
                await updateConfig({ gistId })
            } else {
                isLoading.value = false
                throw new Error('未找到 Nexus Gist，请先初始化')
            }
        }
        
        // 获取 Gist 内容
        const files = await gistRepository.getGistContent(gistId)
        
        const indexFile = files['nexus_index.json']
        if (indexFile) {
            const remoteIndex = JSON.parse(indexFile.content) as NexusIndex
            
            index.value = remoteIndex
            await localStoreRepository.saveIndex(remoteIndex)
            
            // 记录同步状态
            remoteUpdatedAt.value = remoteIndex.updated_at
            lastSyncedAt.value = new Date().toISOString()
            
            // 如果当前没有选中分类，自动选中第一个
            if (!selectedCategoryId.value && remoteIndex.categories.length > 0) {
                selectedCategoryId.value = remoteIndex.categories[0].id
            }
        } else {
            throw new Error('nexus_index.json 不存在')
        }
        
    } catch (e) {
        console.error('[Nexus] 同步失败:', e)
        throw e
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
  async function saveIndex(forceOverwrite = false) {
    if (!index.value || !currentGistId.value) {
      console.warn('[Nexus Save] 无法保存：index 或 gistId 为空')
      return
    }
    
    // 空数据保护：如果本地索引完全为空，阻止推送
    if (index.value.categories.length === 0 && !forceOverwrite) {
      console.warn('[Nexus Save] ⚠️ 本地索引为空，已阻止推送（可能会覆盖远程数据）')
      throw new Error('本地索引为空，拒绝推送以防止数据丢失。如需清空远程，请使用强制覆盖。')
    }
    
    // 冲突检测：获取远程最新版本的 updated_at
    if (!forceOverwrite) {
      try {
        const files = await gistRepository.getGistContent(currentGistId.value)
        const remoteIndexFile = files['nexus_index.json']
        if (remoteIndexFile) {
          const currentRemote = JSON.parse(remoteIndexFile.content) as NexusIndex
          const remoteTime = new Date(currentRemote.updated_at).getTime()
          const localTime = remoteUpdatedAt.value ? new Date(remoteUpdatedAt.value).getTime() : 0
          
          // 如果远程版本比我们上次同步时更新，说明有冲突
          if (remoteTime > localTime) {
            console.warn('[Nexus Save] ⚠️ 检测到冲突：远程有更新的版本！')
            console.warn('[Nexus Save] 远程 updated_at:', currentRemote.updated_at)
            console.warn('[Nexus Save] 本地记录的 updated_at:', remoteUpdatedAt.value)
            throw new Error(`检测到同步冲突！远程数据已被其他设备更新。请先同步再操作。`)
          }
        }
      } catch (e: any) {
        if (e.message?.includes('同步冲突')) {
          throw e  // 重新抛出冲突错误
        }
        // 其他错误（如网络问题）记录但继续
        console.warn('[Nexus Save] 冲突检测失败，继续保存:', e)
      }
    }
    
    // 更新时间戳并保存
    index.value.updated_at = new Date().toISOString()
    await gistRepository.updateGistFile(
      currentGistId.value,
      'nexus_index.json',
      JSON.stringify(index.value, null, 2)
    )
    await localStoreRepository.saveIndex(index.value)
    
    // 更新同步状态
    remoteUpdatedAt.value = index.value.updated_at
    lastSyncedAt.value = new Date().toISOString()
    
    console.log('[Nexus Save] ✅ 保存成功')
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
    lastSyncedAt,
    remoteUpdatedAt,
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
