<script setup lang="ts">
import type { GistIndexCategory } from "../../../core/domain/entities/types";

defineProps<{
  categories: GistIndexCategory[];
  selectedCategoryId: string | null;
  isDark: boolean;
}>();

const emit = defineEmits<{
  "select-category": [categoryId: string];
  "open-context-menu": [event: MouseEvent, categoryId: string];
}>();

function iconClass(iconName: string | undefined) {
  const iconMap: Record<string, string> = {
    folder: "i-heroicons-folder",
    router: "i-heroicons-signal",
    smart_toy: "i-heroicons-sparkles",
    code: "i-heroicons-code-bracket",
    document: "i-heroicons-document-text",
  };
  return iconMap[iconName || "folder"] || "i-heroicons-folder";
}
</script>

<template>
  <div class="flex-1 overflow-y-auto py-2">
    <div v-for="category in categories" :key="category.id" class="px-2 py-1">
      <div
        class="flex items-center px-3 py-2 rounded-md cursor-pointer transition-all duration-200"
        :class="[
          selectedCategoryId === category.id
            ? 'bg-blue-500/20 text-blue-500'
            : isDark
              ? 'hover:bg-slate-800 text-slate-300'
              : 'hover:bg-slate-100 text-slate-600',
        ]"
        @click="emit('select-category', category.id)"
        @contextmenu="emit('open-context-menu', $event, category.id)"
      >
        <div :class="`${iconClass(category.icon)} w-5 h-5`"></div>
        <span class="ml-3 truncate">{{ category.name }}</span>
      </div>
    </div>
  </div>
</template>

