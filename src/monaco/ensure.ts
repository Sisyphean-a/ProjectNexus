import { loader } from "@guolao/vue-monaco-editor";

type MonacoNamespace = typeof import("monaco-editor/esm/vs/editor/editor.api");

let monacoPromise: Promise<MonacoNamespace> | null = null;

export function ensureMonaco(): Promise<MonacoNamespace> {
  if (monacoPromise) return monacoPromise;

  monacoPromise = (async () => {
    const [
      { default: JsonWorker },
      { default: CssWorker },
      { default: HtmlWorker },
      { default: TsWorker },
      { default: EditorWorker },
    ] = await Promise.all([
      import("monaco-editor/esm/vs/language/json/json.worker?worker"),
      import("monaco-editor/esm/vs/language/css/css.worker?worker"),
      import("monaco-editor/esm/vs/language/html/html.worker?worker"),
      import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
      import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    ]);

    (globalThis as any).MonacoEnvironment = {
      getWorker(_: unknown, label: string) {
        if (label === "json") return new JsonWorker();
        if (label === "css" || label === "scss" || label === "less")
          return new CssWorker();
        if (label === "html" || label === "handlebars" || label === "razor")
          return new HtmlWorker();
        if (label === "typescript" || label === "javascript")
          return new TsWorker();
        return new EditorWorker();
      },
    };

    const monaco = await import("monaco-editor/esm/vs/editor/editor.api");

    await Promise.all([
      import("monaco-editor/esm/vs/editor/editor.all.js"),
      import("monaco-editor/esm/vs/language/json/monaco.contribution"),
      import("monaco-editor/esm/vs/language/typescript/monaco.contribution"),
      import("monaco-editor/esm/vs/language/html/monaco.contribution"),
      import("monaco-editor/esm/vs/language/css/monaco.contribution"),
      import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution"),
      import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution"),
      import("monaco-editor/esm/vs/basic-languages/python/python.contribution"),
      import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution"),
      import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution"),
      import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution"),
      import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution"),
    ]);

    loader.config({ monaco });
    return monaco;
  })().catch((err) => {
    monacoPromise = null;
    throw err;
  });

  return monacoPromise;
}

