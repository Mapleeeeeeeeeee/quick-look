import * as monaco from "monaco-editor";
import { readTextFile } from "@tauri-apps/plugin-fs";
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

export function detectLanguage(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return LANGUAGE_MAP[ext] ?? "plaintext";
}

let editor: monaco.editor.IStandaloneCodeEditor | null = null;

export const codeRenderer: Renderer = {
  async mount(container: HTMLElement, req: FileRequest): Promise<void> {
    const content = await readTextFile(req.path);
    const language = detectLanguage(req.path);

    if (editor) {
      const model = monaco.editor.createModel(content, language);
      const oldModel = editor.getModel();
      editor.setModel(model);
      oldModel?.dispose();
    } else {
      editor = monaco.editor.create(container, {
        value: content,
        language,
        theme: "vs-dark",
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
      editor.deltaDecorations(
        [],
        [
          {
            range: new monaco.Range(req.startLine, 1, endLine, 1),
            options: {
              isWholeLine: true,
              className: "line-highlight",
            },
          },
        ],
      );
      editor.revealLineInCenter(req.startLine);
    }
  },

  unmount(): void {
    if (editor) {
      editor.dispose();
      editor = null;
    }
  },
};
