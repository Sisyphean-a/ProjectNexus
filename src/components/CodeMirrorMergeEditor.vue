<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { MergeView } from "@codemirror/merge";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { loadCodeMirrorLanguageExtension } from "./codemirror/languageExtensions";

const props = defineProps<{
  original: string;
  modified: string;
  language?: string;
  theme?: "light" | "dark";
}>();

const containerRef = ref<HTMLElement | null>(null);
let mergeView: MergeView | null = null;
let mountRequestId = 0;
let languageRequestId = 0;

const languageCompartment = new Compartment();
const themeCompartment = new Compartment();

function destroyMergeView() {
  mountRequestId += 1;
  languageRequestId += 1;
  mergeView?.destroy();
  mergeView = null;
}

async function mountMergeView() {
  if (!containerRef.value) return;

  const requestId = ++mountRequestId;
  let languageExtension: Extension = [];
  try {
    languageExtension = await loadCodeMirrorLanguageExtension(props.language);
  } catch (error) {
    console.error("[CodeMirrorMergeEditor] Failed to load language extension", error);
  }

  if (requestId !== mountRequestId || !containerRef.value) {
    return;
  }

  mergeView = new MergeView({
    a: {
      doc: props.original,
      extensions: [
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        languageCompartment.of(languageExtension),
        themeCompartment.of(props.theme === "dark" ? oneDark : []),
      ],
    },
    b: {
      doc: props.modified,
      extensions: [
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        languageCompartment.of(languageExtension),
        themeCompartment.of(props.theme === "dark" ? oneDark : []),
      ],
    },
    parent: containerRef.value,
    collapseUnchanged: { margin: 3, minSize: 4 },
  });
}

onMounted(() => {
  void mountMergeView();
});

onBeforeUnmount(() => {
  destroyMergeView();
});

watch(
  () => [props.original, props.modified],
  () => {
    destroyMergeView();
    void mountMergeView();
  },
);

watch(
  () => props.theme,
  (newTheme) => {
    if (!mergeView) return;
    const themeExt = newTheme === "dark" ? oneDark : [];
    mergeView.a.dispatch({ effects: themeCompartment.reconfigure(themeExt) });
    mergeView.b.dispatch({ effects: themeCompartment.reconfigure(themeExt) });
  },
);

watch(
  () => props.language,
  async (newLanguage) => {
    if (!mergeView) return;

    const requestId = ++languageRequestId;
    let languageExt: Extension = [];
    try {
      languageExt = await loadCodeMirrorLanguageExtension(newLanguage);
    } catch (error) {
      console.error(
        "[CodeMirrorMergeEditor] Failed to switch language extension",
        error,
      );
    }

    if (requestId !== languageRequestId || !mergeView) return;
    mergeView.a.dispatch({ effects: languageCompartment.reconfigure(languageExt) });
    mergeView.b.dispatch({ effects: languageCompartment.reconfigure(languageExt) });
  },
);

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
