<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { Codemirror } from "vue-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { loadCodeMirrorLanguageExtension } from "./codemirror/languageExtensions";

const props = defineProps<{
  modelValue: string;
  language?: string;
  theme?: "light" | "dark";
  readOnly?: boolean;
  fontSize?: number;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "save"): void;
  (e: "change", value: string): void;
}>();

// Custom keymap
const customKeymap = keymap.of([
  {
    key: "Mod-s",
    run: () => {
      emit("save");
      return true;
    },
  },
  ...defaultKeymap,
  ...historyKeymap,
  ...searchKeymap,
]);

const languageExtension = shallowRef<Extension>([]);
let languageRequestId = 0;

watch(
  () => props.language,
  async (language) => {
    const requestId = ++languageRequestId;
    try {
      const extension = await loadCodeMirrorLanguageExtension(language);
      if (requestId !== languageRequestId) {
        return;
      }
      languageExtension.value = extension;
    } catch (error) {
      if (requestId !== languageRequestId) {
        return;
      }
      languageExtension.value = [];
      console.error("[CodeMirrorEditor] Failed to load language extension", error);
    }
  },
  { immediate: true },
);

const extensions = computed(() => {
  const exts = [
    customKeymap,
    EditorView.lineWrapping,
    languageExtension.value,
    EditorState.readOnly.of(props.readOnly || false),
  ];
  
  if (props.theme === 'dark') {
    exts.push(oneDark);
  }
  
  return exts;
});


// Font size handling via CSS variable
const editorStyle = computed(() => ({
  height: "100%",
  fontSize: `${props.fontSize || 14}px`,
}));

function handleChange(val: string) {
  emit('update:modelValue', val);
  emit('change', val);
}
</script>

<template>
  <div class="codemirror-container" :style="editorStyle">
    <Codemirror
      v-model="props.modelValue"
      :extensions="extensions"
      :autofocus="true"
      :indent-with-tab="true"
      :tab-size="2"
      @change="handleChange"
    />
  </div>
</template>

<style scoped>
.codemirror-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

:deep(.cm-editor) {
  height: 100%;
}

:deep(.cm-scroller) {
  font-family: 'Fira Code', Consolas, monospace;
}
</style>
