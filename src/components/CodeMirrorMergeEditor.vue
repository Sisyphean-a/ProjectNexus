<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { MergeView } from "@codemirror/merge";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { getCodeMirrorLanguageExtension } from "./codemirror/languageExtensions";

const props = defineProps<{
  original: string;
  modified: string;
  language?: string;
  theme?: "light" | "dark";
}>();

const containerRef = ref<HTMLElement | null>(null);
let mergeView: MergeView | null = null;

const languageCompartment = new Compartment();
const themeCompartment = new Compartment();

onMounted(() => {
  if (!containerRef.value) return;

  mergeView = new MergeView({
    a: {
      doc: props.original,
      extensions: [
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        languageCompartment.of(getCodeMirrorLanguageExtension(props.language)),
        themeCompartment.of(props.theme === "dark" ? oneDark : []),
      ],
    },
    b: {
      doc: props.modified,
      extensions: [
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        languageCompartment.of(getCodeMirrorLanguageExtension(props.language)),
        themeCompartment.of(props.theme === "dark" ? oneDark : []),
      ],
    },
    parent: containerRef.value,
    collapseUnchanged: { margin: 3, minSize: 4 } // Optional: verify if user wants this. Default nice.
  });
});

onBeforeUnmount(() => {
  mergeView?.destroy();
});

watch(
  () => [props.original, props.modified],
  () => {
    if (mergeView) {
      // Re-create or update transaction? 
      // MergeView architecture is complex for updates. 
      // Easiest is to destroy and recreate if content checks fail, but better to dispatch changes.
      // Alternatively, just destroy and recreate for simplicity as this is a history viewer.
      mergeView.destroy();
      // Re-mount (reuse onMounted logic)
       if (!containerRef.value) return;

        mergeView = new MergeView({
            a: {
            doc: props.original,
            extensions: [
                EditorView.editable.of(false),
                EditorView.lineWrapping,
                languageCompartment.of(getCodeMirrorLanguageExtension(props.language)),
                themeCompartment.of(props.theme === "dark" ? oneDark : []),
            ],
            },
            b: {
            doc: props.modified,
            extensions: [
                EditorView.editable.of(false),
                EditorView.lineWrapping,
                languageCompartment.of(getCodeMirrorLanguageExtension(props.language)),
                themeCompartment.of(props.theme === "dark" ? oneDark : []),
            ],
            },
            parent: containerRef.value,
        });
    }
  }
);

watch(
    () => props.theme,
    (newTheme) => {
        if (!mergeView) return;
        const themeExt = newTheme === "dark" ? oneDark : [];
        mergeView.a.dispatch({ effects: themeCompartment.reconfigure(themeExt) });
        mergeView.b.dispatch({ effects: themeCompartment.reconfigure(themeExt) });
    }
)

watch(
    () => props.language,
    (newLanguage) => {
        if (!mergeView) return;
        const languageExt = getCodeMirrorLanguageExtension(newLanguage);
        mergeView.a.dispatch({ effects: languageCompartment.reconfigure(languageExt) });
        mergeView.b.dispatch({ effects: languageCompartment.reconfigure(languageExt) });
    }
)

</script>

<template>
  <div ref="containerRef" class="merge-editor-container"></div>
</template>

<style scoped>
.merge-editor-container {
  height: 100%;
  width: 100%;
  overflow: hidden;
  font-family: 'Fira Code', Consolas, monospace;
}

:deep(.cm-mergeView) {
  height: 100%;
}

:deep(.cm-mergeViewEditor) {
  height: 100%;
}

:deep(.cm-scroller) {
    font-family: inherit;
}
</style>
