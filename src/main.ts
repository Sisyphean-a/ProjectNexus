import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "virtual:uno.css";
import { loader } from "@guolao/vue-monaco-editor";

// 1. 仅引入核心 API
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

// 2. 引入基础编辑器特性 (查找替换、折叠、右键菜单等)
import "monaco-editor/esm/vs/editor/editor.all.js";

// 3. 引入高级语言特性 (带 Worker 支持:补全、验证)
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
import "monaco-editor/esm/vs/language/html/monaco.contribution";
import "monaco-editor/esm/vs/language/css/monaco.contribution";

// 4. 引入基础语言 (仅高亮)
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";

loader.config({ monaco });

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

// If index.html contains #app, mount it.
// CRXJS might insert content script elsewhere, but for newtab/index.html it's standard.
if (document.getElementById("app")) {
  app.mount("#app");
}
