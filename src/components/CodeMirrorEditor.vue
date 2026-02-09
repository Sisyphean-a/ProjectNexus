<script setup lang="ts">
import { computed } from "vue";
import { Codemirror } from "vue-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";

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

// Language mapping
const getLanguageExtension = (lang: string = "") => {
  switch (lang.toLowerCase()) {
    case "javascript":
    case "js":
    case "typescript":
    case "ts":
      return javascript();
    case "json":
      return json();
    case "html":
      return html();
    case "css":
      return css();
    case "yaml":
    case "yml":
      return yaml();
    case "markdown":
    case "md":
      return markdown();
    default:
      return [];
  }
};

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

const extensions = computed(() => {
  const exts = [
    customKeymap,
    EditorView.lineWrapping,
    getLanguageExtension(props.language),
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
</script>

<template>
  <div class="codemirror-container" :style="editorStyle">
    <Codemirror
      v-model="props.modelValue"
      :extensions="extensions"
      :autofocus="true"
      :indent-with-tab="true"
      :tab-size="2"
      @change="(val) => { emit('update:modelValue', val); emit('change', val); }"
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
