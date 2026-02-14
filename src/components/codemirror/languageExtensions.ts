import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

const EMPTY_EXTENSION: Extension = [];
const extensionCache = new Map<string, Promise<Extension>>();

function normalizeLanguage(lang?: string): string {
  switch ((lang || "").toLowerCase()) {
    case "javascript":
    case "js":
      return "javascript";
    case "typescript":
    case "ts":
      return "typescript";
    case "json":
      return "json";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "yaml":
    case "yml":
      return "yaml";
    case "markdown":
    case "md":
      return "markdown";
    case "python":
    case "py":
      return "python";
    case "xml":
    case "xhtml":
    case "svg":
      return "xml";
    case "shell":
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return "shell";
    case "plaintext":
    case "text":
    case "txt":
    default:
      return "plaintext";
  }
}

function loadLanguageExtension(normalizedLanguage: string): Promise<Extension> {
  switch (normalizedLanguage) {
    case "javascript":
      return import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript(),
      );
    case "typescript":
      return import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ typescript: true }),
      );
    case "json":
      return import("@codemirror/lang-json").then(({ json }) => json());
    case "html":
      return import("@codemirror/lang-html").then(({ html }) => html());
    case "css":
      return import("@codemirror/lang-css").then(({ css }) => css());
    case "yaml":
      return import("@codemirror/lang-yaml").then(({ yaml }) => yaml());
    case "markdown":
      return import("@codemirror/lang-markdown").then(({ markdown }) =>
        markdown(),
      );
    case "python":
      return import("@codemirror/lang-python").then(({ python }) => python());
    case "xml":
      return import("@codemirror/lang-xml").then(({ xml }) => xml());
    case "shell":
      return import("@codemirror/legacy-modes/mode/shell").then(({ shell }) =>
        StreamLanguage.define(shell),
      );
    default:
      return Promise.resolve(EMPTY_EXTENSION);
  }
}

export function loadCodeMirrorLanguageExtension(
  lang?: string,
): Promise<Extension> {
  const normalizedLanguage = normalizeLanguage(lang);
  const cached = extensionCache.get(normalizedLanguage);
  if (cached) {
    return cached;
  }

  const loadedExtension = loadLanguageExtension(normalizedLanguage);
  extensionCache.set(normalizedLanguage, loadedExtension);
  return loadedExtension;
}
