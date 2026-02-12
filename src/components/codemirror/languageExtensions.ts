import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { shell as shellMode } from "@codemirror/legacy-modes/mode/shell";

const shellLanguage = StreamLanguage.define(shellMode);

export function getCodeMirrorLanguageExtension(lang?: string): Extension {
  switch ((lang || "").toLowerCase()) {
    case "javascript":
    case "js":
      return javascript();
    case "typescript":
    case "ts":
      return javascript({ typescript: true });
    case "json":
      return json();
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "yaml":
    case "yml":
      return yaml();
    case "markdown":
    case "md":
      return markdown();
    case "python":
    case "py":
      return python();
    case "xml":
    case "xhtml":
    case "svg":
      return xml();
    case "shell":
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return shellLanguage;
    case "plaintext":
    case "text":
    case "txt":
    default:
      return [];
  }
}
