<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useNexusStore } from '../../stores/useNexusStore'
import { gistRepository } from '../../infrastructure'
import { NButton, useMessage } from 'naive-ui'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'

const nexusStore = useNexusStore()
const message = useMessage()

// Editor state
const code = ref('')
const language = ref('yaml')
const isDirty = ref(false)
const isLoadingContent = ref(false)

// Determine which file is selected
const selectedFile = computed(() => {
    if (!nexusStore.selectedFileId) return null
    return nexusStore.currentFileList.find(f => f.id === nexusStore.selectedFileId) || null
})

// Watch selection change to load content
watch(() =>nexusStore.selectedFileId, async (newId) => {
    if (!newId || !nexusStore.currentGistId) {
        code.value = ''
        return
    }
    
    // Check if we have cached content? 
    // Domain logic: GistRepository.getGistContent fetches ALL files.
    // So if synced, we likely have it. But we didn't store file CONTENT in Index. 
    // Store only has Index.
    // We need to fetch file content on demand or pre-fetch?
    // Architecture said: "Click specific item -> Get content".
    // So we fetch now.
    
    isLoadingContent.value = true
    try {
        // Optimization: Cache content in a store or LocalStore cache?
        // For now, simpler: Fetch from Gist (or LocalStore cache if implemented).
        // Let's implement a simple fetch from GistRepository.getGistContent (returns all).
        // This is inefficient (fetches all files). 
        // Gist API allows fetching single file raw content? 
        // Octokit 'get' fetches metadata which includes content if small.
        
        // Better: use LocalStore cache for content.
        // But for MVP phase 2/3, getting from Gist is safer source of truth.
        // We will cache it in memory `code` ref for now.
        
        const files = await gistRepository.getGistContent(nexusStore.currentGistId)
        const file = files[selectedFile.value?.gist_file || '']
        
        if (file) {
            code.value = file.content
            // Auto-detect language from extension
            const ext = file.filename.split('.').pop()
            if (ext === 'md') language.value = 'markdown'
            else if (ext === 'json') language.value = 'json'
            else if (ext === 'js' || ext === 'ts') language.value = 'javascript'
            else language.value = 'yaml'
            
            isDirty.value = false
        } else {
            code.value = '# Error loading content'
        }
    } catch (e) {
        console.error(e)
        message.error('Failed to load file content')
    } finally {
        isLoadingContent.value = false
    }
})

async function handleSave() {
    if (!selectedFile.value || !nexusStore.currentGistId) return
    
    // Optimistic UI?
    const savingMessage = message.loading('Saving...', { duration: 0 })
    try {
        await gistRepository.updateGistFile(nexusStore.currentGistId, selectedFile.value.gist_file, code.value)
        isDirty.value = false
        savingMessage.destroy()
        message.success('Saved')
    } catch (e) {
        savingMessage.destroy()
        message.error('Failed to save')
        console.error(e)
    }
}

// Shortcuts
function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
    }
}

</script>

<template>
  <div class="h-full flex flex-col relative" @keydown="handleKeyDown">
    <!-- Header -->
    <div class="h-12 border-b border-slate-800 bg-slate-900 flex items-center px-4 justify-between">
        <div class="flex items-center space-x-2 overflow-hidden">
            <div class="i-heroicons-document-text text-slate-500"></div>
            <span class="font-mono text-sm truncate max-w-[200px]" :class="isDirty ? 'italic text-yellow-500' : 'text-slate-300'">
                {{ selectedFile ? selectedFile.title : 'No file selected' }}
                <span v-if="isDirty">*</span>
            </span>
        </div>
        
        <div class="flex items-center space-x-2">
            <NButton 
                v-if="selectedFile" 
                size="tiny" 
                secondary 
                type="primary" 
                :disabled="!isDirty"
                @click="handleSave"
            >
                Save
            </NButton>
        </div>
    </div>

    <!-- Editor -->
    <div class="flex-1 relative overflow-hidden bg-[#1e1e1e]"> <!-- Monaco Dark BG match -->
        <div v-if="!selectedFile" class="absolute inset-0 flex items-center justify-center text-slate-600">
            <div class="text-center">
                <div class="i-heroicons-code-bracket-square w-12 h-12 mx-auto mb-2 opacity-20"></div>
                <p>Select a file to edit</p>
            </div>
        </div>
        
        <VueMonacoEditor 
            v-else
            v-model:value="code"
            :language="language"
            theme="vs-dark"
            :options="{
                automaticLayout: true,
                fontSize: 14,
                fontFamily: 'Fira Code, monospace',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 16 }
            }"
            @change="isDirty = true"
            class="h-full w-full"
        />
        
         <!-- Loading Overlay -->
        <div v-if="isLoadingContent" class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-10">
            <div class="i-heroicons-arrow-path animate-spin w-8 h-8 text-blue-500"></div>
        </div>
    </div>
  </div>
</template>
