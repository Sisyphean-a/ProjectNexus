<script setup lang="ts">
import { useNexusStore } from '../../stores/useNexusStore'
import { NMenu, NButton, NIcon } from 'naive-ui'
import { h, computed } from 'vue'

const nexusStore = useNexusStore()

// Simple wrapper for Icons (in real app, import specific icons)
const renderIcon = (iconName: string) => {
    // Determine icon based on string name, or default
    return () => h('div', { class: 'i-heroicons-folder w-5 h-5' }) // Placeholder using UnoCSS icon class if possible
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
    nexusStore.selectedFileId = null // Reset file selection
}

async function handleInitialize() {
    await nexusStore.initializeGist()
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
            <p class="text-sm text-slate-400 mb-4">No Configuration Found</p>
            <NButton type="primary" size="small" @click="handleInitialize">
                Initialize Vault
            </NButton>
        </div>
        
        <NMenu 
            v-else
            :options="menuOptions"
            :value="nexusStore.selectedCategoryId"
            @update:value="handleUpdateValue"
        />
    </div>

    <div class="p-4 border-t border-slate-800">
        <div class="flex items-center text-xs text-slate-500">
            <span class="flex-1">Synced</span>
            <div class="w-2 h-2 rounded-full bg-emerald-500"></div>
        </div>
    </div>
  </div>
</template>
