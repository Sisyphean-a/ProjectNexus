<script setup lang="ts">
import { ref, computed, h } from 'vue'
import { useNexusStore } from '../../stores/useNexusStore'
import { NMenu, NButton, NIcon, NDropdown, NInput, NModal, NSpace, useMessage, useDialog } from 'naive-ui'

const nexusStore = useNexusStore()
const message = useMessage()
const dialog = useDialog()

// 新建分类模态框
const showAddModal = ref(false)
const newCategoryName = ref('')
const isAdding = ref(false)

// 右键菜单
const showContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuCategoryId = ref<string | null>(null)

// 重命名模态框
const showRenameModal = ref(false)
const renameCategoryName = ref('')
const renameCategoryId = ref<string | null>(null)

// 图标渲染
const renderIcon = (iconName: string) => {
  const iconMap: Record<string, string> = {
    folder: 'i-heroicons-folder',
    router: 'i-heroicons-signal',
    smart_toy: 'i-heroicons-sparkles',
    code: 'i-heroicons-code-bracket',
    document: 'i-heroicons-document-text',
  }
  return () => h('div', { class: `${iconMap[iconName] || 'i-heroicons-folder'} w-5 h-5` })
}

const menuOptions = computed(() => {
  if (!nexusStore.index) return []
  return nexusStore.index.categories.map(cat => ({
    label: cat.name,
    key: cat.id,
    icon: renderIcon(cat.icon || 'folder')
  }))
})

function handleUpdateValue(key: string) {
  nexusStore.selectedCategoryId = key
  nexusStore.selectedFileId = null
}

async function handleInitialize() {
  await nexusStore.initializeGist()
}

// 新建分类
async function handleAddCategory() {
  if (!newCategoryName.value.trim()) {
    message.warning('请输入分类名称')
    return
  }
  isAdding.value = true
  try {
    await nexusStore.addCategory(newCategoryName.value.trim())
    message.success('分类创建成功')
    showAddModal.value = false
    newCategoryName.value = ''
  } catch (e) {
    message.error('创建失败')
  } finally {
    isAdding.value = false
  }
}

// 右键菜单
function handleContextMenu(e: MouseEvent, catId: string) {
  e.preventDefault()
  contextMenuCategoryId.value = catId
  contextMenuX.value = e.clientX
  contextMenuY.value = e.clientY
  showContextMenu.value = true
}

function handleClickOutside() {
  showContextMenu.value = false
}

const contextMenuOptions = [
  { label: '重命名', key: 'rename' },
  { label: '删除', key: 'delete' }
]

async function handleContextMenuSelect(key: string) {
  showContextMenu.value = false
  const catId = contextMenuCategoryId.value
  if (!catId) return

  if (key === 'rename') {
    const cat = nexusStore.index?.categories.find(c => c.id === catId)
    if (cat) {
      renameCategoryId.value = catId
      renameCategoryName.value = cat.name
      showRenameModal.value = true
    }
  } else if (key === 'delete') {
    const cat = nexusStore.index?.categories.find(c => c.id === catId)
    dialog.warning({
      title: '确认删除',
      content: `确定要删除分类「${cat?.name}」及其所有配置吗？此操作不可撤销。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await nexusStore.deleteCategory(catId)
          message.success('已删除')
        } catch (e) {
          message.error('删除失败')
        }
      }
    })
  }
}

// 重命名
async function handleRenameCategory() {
  if (!renameCategoryName.value.trim() || !renameCategoryId.value) return
  try {
    await nexusStore.updateCategory(renameCategoryId.value, { name: renameCategoryName.value.trim() })
    message.success('已重命名')
    showRenameModal.value = false
  } catch (e) {
    message.error('重命名失败')
  }
}

// 同步
const isSyncing = ref(false)
async function handleSync() {
  isSyncing.value = true
  try {
    await nexusStore.sync()
    message.success('同步完成')
  } catch (e) {
    message.error('同步失败')
  } finally {
    isSyncing.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="p-4 flex items-center space-x-2 border-b border-slate-800">
      <div class="i-heroicons-cube-transparent w-6 h-6 text-blue-500"></div>
      <span class="font-bold text-lg tracking-wide">NEXUS</span>
    </div>

    <div class="flex-1 overflow-y-auto py-2">
      <div v-if="!nexusStore.index && !nexusStore.isLoading" class="p-4 text-center">
        <p class="text-sm text-slate-400 mb-4">未找到配置</p>
        <NButton type="primary" size="small" @click="handleInitialize">
          初始化仓库
        </NButton>
      </div>
      
      <template v-else>
        <!-- 自定义菜单以支持右键 -->
        <div 
          v-for="cat in nexusStore.index?.categories" 
          :key="cat.id"
          class="px-2 py-1"
        >
          <div
            class="flex items-center px-3 py-2 rounded-md cursor-pointer transition-all duration-200"
            :class="[
              nexusStore.selectedCategoryId === cat.id 
                ? 'bg-blue-500/20 text-blue-400' 
                : 'hover:bg-slate-800 text-slate-300'
            ]"
            @click="handleUpdateValue(cat.id)"
            @contextmenu="handleContextMenu($event, cat.id)"
          >
            <component :is="renderIcon(cat.icon || 'folder')" />
            <span class="ml-3 truncate">{{ cat.name }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- 底部工具栏 -->
    <div class="p-3 border-t border-slate-800 space-y-2">
      <NButton 
        block 
        size="small" 
        type="primary" 
        ghost
        @click="showAddModal = true"
        :disabled="!nexusStore.index"
      >
        <template #icon>
          <div class="i-heroicons-plus w-4 h-4"></div>
        </template>
        新建分类
      </NButton>
      
      <div class="flex items-center justify-between text-xs text-slate-500">
        <span>{{ nexusStore.isLoading || isSyncing ? '同步中...' : 'Synced' }}</span>
        <NButton 
          text 
          size="tiny" 
          :loading="isSyncing"
          @click="handleSync"
        >
          <template #icon>
            <div class="i-heroicons-arrow-path w-4 h-4"></div>
          </template>
        </NButton>
      </div>
    </div>

    <!-- 右键菜单 -->
    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="contextMenuX"
      :y="contextMenuY"
      :options="contextMenuOptions"
      :show="showContextMenu"
      @select="handleContextMenuSelect"
      @clickoutside="handleClickOutside"
    />

    <!-- 新建分类模态框 -->
    <NModal v-model:show="showAddModal" preset="dialog" title="新建分类">
      <NInput 
        v-model:value="newCategoryName" 
        placeholder="输入分类名称" 
        @keydown.enter="handleAddCategory"
      />
      <template #action>
        <NSpace>
          <NButton @click="showAddModal = false">取消</NButton>
          <NButton type="primary" :loading="isAdding" @click="handleAddCategory">创建</NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 重命名模态框 -->
    <NModal v-model:show="showRenameModal" preset="dialog" title="重命名分类">
      <NInput 
        v-model:value="renameCategoryName" 
        placeholder="输入新名称" 
        @keydown.enter="handleRenameCategory"
      />
      <template #action>
        <NSpace>
          <NButton @click="showRenameModal = false">取消</NButton>
          <NButton type="primary" @click="handleRenameCategory">确定</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
