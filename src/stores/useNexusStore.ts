import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { gistRepository, localStoreRepository, nexusDb } from '../infrastructure'
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
        
        // 1. Check Metadata first (Incremental Check)
        const gistMeta = await gistRepository.fetchGist(gistId)
        const remoteTime = gistMeta.updated_at
        
        if (remoteUpdatedAt.value === remoteTime && index.value) {
           console.log('[Nexus Sync] 本地已是最新，跳过同步')
           return
        }

        console.log('[Nexus Sync] 发现新版本，开始全量拉取...')

        // 2. Fetch Full Content
        const files = await gistRepository.getGistContent(gistId)
        
        const indexFile = files['nexus_index.json']
        if (indexFile) {
            const remoteIndex = JSON.parse(indexFile.content) as NexusIndex
            
            index.value = remoteIndex
            await localStoreRepository.saveIndex(remoteIndex)
            
            // 3. Update DB (Bulk Put)
            const dbItems: any[] = []
            
            // Build map of filename -> item info to get IDs
            const fileMap = new Map<string, { id: string, title: string, tags: string[], language: string }>()
            remoteIndex.categories.forEach(cat => {
                cat.items.forEach(item => {
                    fileMap.set(item.gist_file, {
                        id: item.id,
                        title: item.title,
                        tags: item.tags || [],
                        language: item.language || 'yaml'  // 从索引读取语言
                    })
                })
            })

            for (const [filename, file] of Object.entries(files)) {
                if (filename === 'nexus_index.json') continue
                
                const info = fileMap.get(filename)
                if (info) {
                    dbItems.push({
                        id: info.id,
                        gist_filename: filename,
                        title: info.title,
                        content: file.content,
                        // 从索引读取语言（索引是唯一数据源）
                        language: info.language,
                        tags: info.tags,
                        updated_at: file.updated_at || new Date().toISOString(),
                        is_dirty: false
                    })
                }
            }
            
            if (dbItems.length > 0) {
                await nexusDb.files.bulkPut(dbItems)
            }
            
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

  // ========== Content Actions ==========
  async function getFileContent(fileId: string): Promise<string> {
      const file = await nexusDb.files.get(fileId)
      return file ? file.content : ''
  }

  async function saveFileContent(fileId: string, content: string) {
      if (!index.value || !currentGistId.value) return

      // 1. Find file info
      // We need to find the file item to get gist_filename
      let targetItem: any = null
      for (const cat of index.value.categories) {
          const item = cat.items.find(i => i.id === fileId)
          if (item) {
              targetItem = item
              break
          }
      }
      if (!targetItem) throw new Error('File not found in index')

      // 2. Save to Local DB (Immediate UI feedback)
      await nexusDb.files.update(fileId, { 
          content, 
          is_dirty: true,
          updated_at: new Date().toISOString()
      })
      
      // 3. Async Push to Gist
      // In a real app, this might be a queue. For now, we await it but UI treats it as "saving..."
      // Or we can just fire and forget if we trust the dirty flag sync later.
      // But the user plan says "Async push".
      
      try {
          await gistRepository.updateGistFile(
              currentGistId.value,
              targetItem.gist_file,
              content
          )
          // Mark as clean
          await nexusDb.files.update(fileId, { is_dirty: false })
      } catch (e) {
          console.error('Background Sync Failed', e)
          // It remains dirty in DB, to be synced next time (Need a syncDirty mechanism later)
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

    // 先保存分类引用（splice 之后就拿不到了）
    const category = index.value.categories[catIndex]

    // 1. 先更新本地索引并保存 (确保状态一致性为第一优先级)
    index.value.categories.splice(catIndex, 1)
    
    // 如果没有任何分类了，允许强制保存以清空远程
    const isNowEmpty = index.value.categories.length === 0
    await saveIndex(isNowEmpty)
    
    // 2. 异步清理孤儿文件 (即使失败也不影响主流程)
    const gistId = currentGistId.value
    Promise.all(category.items.map(async (item) => {
        try {
            // 删除本地 DB
            await nexusDb.files.delete(item.id)
            
            // 删除远程文件
            await gistRepository.updateGistFile(gistId, item.gist_file, null)
        } catch (e) {
            console.warn(`[Nexus] Failed to cleanup file ${item.gist_file}`, e)
        }
    })).then(() => {
        console.log('[Nexus] Cleanup completed')
    })
    
    // 重置选择
    if (selectedCategoryId.value === id) {
      selectedCategoryId.value = index.value.categories[0]?.id || null
      selectedFileId.value = null
    }
  }

  // ========== 文件 CRUD ==========
  
  // 语言 -> 扩展名映射
  const languageToExtension: Record<string, string> = {
    yaml: 'yaml',
    json: 'json',
    markdown: 'md',
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    html: 'html',
    css: 'css',
    shell: 'sh',
    xml: 'xml',
    plaintext: 'txt'
  }

  async function addFile(categoryId: string, title: string, language = 'yaml', initialContent = '') {
    if (!index.value || !currentGistId.value) return null

    const cat = index.value.categories.find(c => c.id === categoryId)
    if (!cat) return null

    const fileId = generateId()
    const ext = languageToExtension[language] || 'txt'
    const filename = `${fileId}.${ext}`

    const newItem = {
      id: fileId,
      title,
      gist_file: filename,
      language,  // 保存语言到索引
      tags: [] as string[]
    }

    // 先在本地创建
    await nexusDb.files.put({
        id: fileId,
        gist_filename: filename,
        title,
        content: initialContent || `# ${title}\n`,
        language,
        tags: [],
        updated_at: new Date().toISOString(),
        is_dirty: true
    })

    // Update Index
    cat.items.push(newItem)
    await saveIndex() // This pushes index to Gist

    // Push file content to Gist
    await gistRepository.updateGistFile(currentGistId.value, filename, initialContent || `# ${title}\n`)
    
    // Mark clean
    await nexusDb.files.update(fileId, { is_dirty: false })

    selectedFileId.value = fileId
    return newItem
  }

  /**
   * 更改文件语言（同时重命名 Gist 文件扩展名）
   * 这是一个完整的操作：更新索引 -> 重命名远程文件 -> 更新本地数据库
   */
  async function changeFileLanguage(fileId: string, newLanguage: string): Promise<boolean> {
    if (!index.value || !currentGistId.value) return false

    // 1. 找到文件在索引中的位置
    let targetItem: any = null
    for (const cat of index.value.categories) {
      const item = cat.items.find(i => i.id === fileId)
      if (item) {
        targetItem = item
        break
      }
    }
    if (!targetItem) return false

    // 2. 如果语言没变，直接返回
    if (targetItem.language === newLanguage) return true

    // 3. 获取当前文件内容
    const localFile = await nexusDb.files.get(fileId)
    if (!localFile) return false

    // 4. 计算新文件名
    const oldFilename = targetItem.gist_file
    const baseId = oldFilename.split('.')[0]  // 提取文件 ID 部分
    const newExt = languageToExtension[newLanguage] || 'txt'
    const newFilename = `${baseId}.${newExt}`

    // 5. 如果文件名没变（比如 yaml -> yml 都是 yaml），只更新语言
    if (oldFilename === newFilename) {
      targetItem.language = newLanguage
      await nexusDb.files.update(fileId, { language: newLanguage })
      await saveIndex()
      return true
    }

    // 6. 重命名 Gist 文件（删除旧 + 创建新）
    await gistRepository.renameFile(
      currentGistId.value,
      oldFilename,
      newFilename,
      localFile.content
    )

    // 7. 更新索引
    targetItem.gist_file = newFilename
    targetItem.language = newLanguage
    await saveIndex()

    // 8. 更新本地数据库
    await nexusDb.files.update(fileId, {
      gist_filename: newFilename,
      language: newLanguage
    })

    return true
  }

  // 获取文件语言
  async function getFileLanguage(fileId: string): Promise<string> {
    const file = await nexusDb.files.get(fileId)
    return file?.language || 'yaml'
  }

  async function updateFile(fileId: string, updates: { title?: string; tags?: string[] }) {
    if (!index.value) return
    for (const cat of index.value.categories) {
      const file = cat.items.find(f => f.id === fileId)
      if (file) {
        if (updates.title !== undefined) file.title = updates.title
        if (updates.tags !== undefined) file.tags = updates.tags
        
        // Update DB metadata as well
        await nexusDb.files.update(fileId, {
            title: file.title,
            tags: file.tags
        })

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
    
    // Delete from DB
    await nexusDb.files.delete(fileId)

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
    deleteFile,
    getFileContent,
    saveFileContent,
    changeFileLanguage,
    getFileLanguage
  }
})
