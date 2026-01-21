<script setup lang="ts">
import { useNexusStore } from '../../stores/useNexusStore'
import { NList, NListItem, NEmpty, NInput } from 'naive-ui'
import { ref, computed } from 'vue'

import Fuse from 'fuse.js'
import type { GistIndexItem } from '../../core/domain/types'

const nexusStore = useNexusStore()
const searchQuery = ref('')

const fuse = computed(() => new Fuse<GistIndexItem>(nexusStore.currentFileList, {
    keys: ['title', { name: 'tags', weight: 0.7 }],
    threshold: 0.3,
    ignoreLocation: true
}))

const filteredList = computed(() => {
    const list = nexusStore.currentFileList
    if (!searchQuery.value) return list
    return fuse.value.search(searchQuery.value).map(result => result.item)
})

function handleSelect(id: string) {
    nexusStore.selectedFileId = id
}
</script>

<template>
  <div class="h-full flex flex-col bg-slate-800/50">
     <!-- Search Header -->
     <div class="p-4 border-b border-slate-700/50">
        <NInput 
            v-model:value="searchQuery" 
            placeholder="Search..." 
            clearable 
            size="small"
            class="bg-slate-900 border-none"
        >
            <template #prefix>
                <div class="i-heroicons-magnifying-glass w-4 h-4 text-slate-500"></div>
            </template>
        </NInput>
     </div>

     <!-- List -->
     <div class="flex-1 overflow-y-auto">
        <div v-if="!nexusStore.selectedCategoryId" class="p-8 text-center text-slate-500 text-sm">
            Select a category
        </div>
        
        <NEmpty v-else-if="filteredList.length === 0" description="No items found" class="mt-10" />

        <NList v-else hoverable clickable>
            <NListItem
                v-for="item in filteredList"
                :key="item.id"
                class="cursor-pointer transition-colors duration-200"
                :class="{ 'bg-blue-500/20 border-l-2 border-blue-500': nexusStore.selectedFileId === item.id }"
                @click="handleSelect(item.id)"
            >
                <div class="px-4 py-2">
                    <div class="font-medium text-slate-200">{{ item.title }}</div>
                    <div class="flex items-center mt-1 space-x-2">
                        <span v-for="tag in item.tags" :key="tag" class="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                            {{ tag }}
                        </span>
                    </div>
                </div>
            </NListItem>
        </NList>
     </div>
  </div>
</template>
