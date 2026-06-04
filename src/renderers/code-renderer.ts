import * as monaco from "monaco-editor";
import type { FileRequest, Renderer } from "../types";

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".scala": "scala",
  ".r": "r",
  ".lua": "lua",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".sql": "sql",
  ".html": "html",
  ".css": "css",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".xml": "xml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".graphql": "graphql",
  ".dockerfile": "dockerfile",
  ".tf": "hcl",
  ".vue": "html",
  ".svelte": "html",
};

export const MONACO_THEME = "vs-dark";

export function detectLanguage(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return LANGUAGE_MAP[ext] ?? "plaintext";
}

export async function createColorizedCodeBlock(
  filePath: string,
  content: string,
): Promise<HTMLElement> {
  const language = detectLanguage(filePath);
  const pre = document.createElement("pre");
  pre.className = "md-code-preview";

  const code = document.createElement("code");
  code.className = "md-code-preview__content";
  code.setAttribute("data-lang", language);
  code.textContent = content;

  pre.appendChild(code);
  await monaco.editor.colorizeElement(code, { theme: MONACO_THEME });

  return pre;
}

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let currentPath: string | null = null;
let currentDecorations: string[] = [];
const cachedModels = new Map<string, monaco.editor.ITextModel>();
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();

function saveCurrentViewState(): void {
  if (editor && currentPath) {
    const state = editor.saveViewState();
    if (state) viewStates.set(currentPath, state);
  }
}

function getOrCreateModel(
  content: string,
  language: string,
  filePath: string,
): monaco.editor.ITextModel {
  const existing = cachedModels.get(filePath);
  if (existing && !existing.isDisposed()) {
    if (existing.getValue() !== content) {
      existing.setValue(content);
    }
    return existing;
  }
  const model = monaco.editor.createModel(content, language);
  cachedModels.set(filePath, model);
  return model;
}

export const codeRenderer: Renderer = {
  async mount(container: HTMLElement, req: FileRequest): Promise<void> {
    saveCurrentViewState();

    const response = await fetch(`file://${req.path}`);
    const content = await response.text();
    const language = detectLanguage(req.path);
    const model = getOrCreateModel(content, language, req.path);

    currentPath = req.path;

    if (editor) {
      editor.setModel(model);
    } else {
      editor = monaco.editor.create(container, {
        model,
        theme: MONACO_THEME,
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fontSize: 13,
        lineNumbers: "on",
        renderLineHighlight: "none",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      });
    }

    if (req.startLine !== undefined) {
      const endLine = req.endLine ?? req.startLine;
      currentDecorations = editor.deltaDecorations(currentDecorations, [
        {
          range: new monaco.Range(req.startLine, 1, endLine, 1),
          options: {
            isWholeLine: true,
            className: "line-highlight",
          },
        },
      ]);
      editor.setScrollTop(editor.getTopForLineNumber(req.startLine));
    } else {
      currentDecorations = editor.deltaDecorations(currentDecorations, []);
      const savedState = viewStates.get(req.path);
      if (savedState) {
        editor.restoreViewState(savedState);
      }
    }
  },

  unmount(): void {
    saveCurrentViewState();
    if (editor) {
      editor.dispose();
      editor = null;
    }
    for (const model of cachedModels.values()) {
      if (!model.isDisposed()) model.dispose();
    }
    cachedModels.clear();
    viewStates.clear();
    currentDecorations = [];
    currentPath = null;
  },
};

export function triggerFind(): void {
  editor?.getAction("actions.find")?.run();
}
