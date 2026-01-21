<script setup lang="ts">
import { onMounted } from 'vue'
import { NLayout, NLayoutSider, NLayoutContent } from 'naive-ui'
import { useNexusStore } from '../stores/useNexusStore'
import Sidebar from '../components/layout/Sidebar.vue'
import ConfigList from '../components/layout/ConfigList.vue'
import EditorPane from '../components/layout/EditorPane.vue'

const nexusStore = useNexusStore()

onMounted(async () => {
    // Check if we need to initialize a new Index
    if (!nexusStore.currentGistId) {
        // Ask user or auto-create? 
        // For MVP, if no gist ID, we might show an "Initialize" state in Sidebar or center.
        // Assuming user might be new.
    }
})
</script>

<template>
  <NLayout has-sider class="h-full">
    <!-- Sidebar (Categories) -->
    <NLayoutSider
      width="240"
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      show-trigger
      class="bg-slate-900/95 backdrop-blur"
    >
      <Sidebar />
    </NLayoutSider>

    <!-- Content Area Split: List | Editor -->
    <NLayout has-sider>
        <!-- List View -->
        <NLayoutSider
            width="300"
            bordered
            class="bg-slate-800/80 backdrop-blur"
        >
            <ConfigList />
        </NLayoutSider>
        
        <!-- Main Editor -->
        <NLayoutContent class="bg-slate-900">
            <EditorPane />
        </NLayoutContent>
    </NLayout>
  </NLayout>
</template>
