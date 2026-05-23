// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type FakeEditor = {
  setModel: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  deltaDecorations: ReturnType<typeof vi.fn>;
  getTopForLineNumber: ReturnType<typeof vi.fn>;
  setScrollTop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  isDisposed: boolean;
};

const createdEditors: FakeEditor[] = [];

const makeEditor = (): FakeEditor => {
  let currentModel: unknown = null;
  const editor: FakeEditor = {
    setModel: vi.fn((model) => {
      currentModel = model;
    }),
    getModel: vi.fn(() => currentModel),
    deltaDecorations: vi.fn(),
    getTopForLineNumber: vi.fn().mockReturnValue(0),
    setScrollTop: vi.fn(),
    dispose: vi.fn(),
    isDisposed: false,
  };
  editor.dispose.mockImplementation(() => {
    editor.isDisposed = true;
  });
  return editor;
};

vi.mock("monaco-editor", () => {
  return {
    editor: {
      create: vi.fn((_container: HTMLElement, _options: unknown) => {
        const editor = makeEditor();
        createdEditors.push(editor);
        return editor;
      }),
      createModel: vi.fn((content: string, lang: string) => ({
        content,
        lang,
        dispose: vi.fn(),
      })),
    },
    Range: vi.fn().mockImplementation(function (
      this: unknown,
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number,
    ) {
      return { startLineNumber, startColumn, endLineNumber, endColumn };
    }),
  };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockResolvedValue("file content here"),
}));

import { detectLanguage, codeRenderer } from "./code-renderer";

describe("detectLanguage", () => {
  it.each([
    ["typescript", "main.ts"],
    ["typescript", "app.tsx"],
    ["javascript", "index.js"],
    ["javascript", "app.jsx"],
    ["python", "script.py"],
    ["rust", "lib.rs"],
    ["go", "main.go"],
    ["java", "App.java"],
    ["c", "main.c"],
    ["cpp", "main.cpp"],
    ["css", "style.css"],
    ["html", "page.html"],
    ["json", "data.json"],
    ["yaml", "config.yaml"],
    ["yaml", "config.yml"],
    ["ini", "Cargo.toml"],
    ["sql", "query.sql"],
    ["shell", "script.sh"],
    ["shell", "run.bash"],
    ["graphql", "schema.graphql"],
    ["dockerfile", "Dockerfile.dockerfile"],
    ["swift", "main.swift"],
    ["kotlin", "App.kt"],
    ["html", "app.vue"],
    ["plaintext", "unknown.xyz"],
    ["plaintext", "Makefile"],
  ])("returns %s language when given %s", (expected, filename) => {
    expect(detectLanguage(`/path/to/${filename}`)).toBe(expected);
  });
});

describe("codeRenderer lifecycle", () => {
  let container: HTMLElement;

  beforeEach(() => {
    createdEditors.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    codeRenderer.unmount();
  });

  afterEach(() => {
    codeRenderer.unmount();
    document.body.removeChild(container);
  });

  it("creates a new editor on first mount", async () => {
    await codeRenderer.mount(container, { path: "/proj/main.ts" });

    expect(createdEditors.length).toBe(1);
    expect(createdEditors[0].isDisposed).toBe(false);
  });

  it("reuses existing editor on subsequent mount instead of creating a new one", async () => {
    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    await codeRenderer.mount(container, { path: "/proj/b.ts" });

    expect(createdEditors.length).toBe(1);
    expect(createdEditors[0].setModel).toHaveBeenCalled();
  });

  it("disposes editor on unmount", async () => {
    await codeRenderer.mount(container, { path: "/proj/main.ts" });
    codeRenderer.unmount();

    expect(createdEditors[0].isDisposed).toBe(true);
  });

  it("creates a new editor after unmount and remount", async () => {
    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    codeRenderer.unmount();
    await codeRenderer.mount(container, { path: "/proj/b.ts" });

    expect(createdEditors.length).toBe(2);
    expect(createdEditors[1].isDisposed).toBe(false);
  });

  it("applies line decorations and reveals start line when startLine is provided", async () => {
    await codeRenderer.mount(container, {
      path: "/proj/main.ts",
      startLine: 5,
      endLine: 10,
    });

    expect(createdEditors[0].deltaDecorations).toHaveBeenCalled();
    expect(createdEditors[0].getTopForLineNumber).toHaveBeenCalledWith(5);
    expect(createdEditors[0].setScrollTop).toHaveBeenCalled();
  });

  it("does not apply decorations when no startLine is provided", async () => {
    await codeRenderer.mount(container, { path: "/proj/main.ts" });

    expect(createdEditors[0].deltaDecorations).not.toHaveBeenCalled();
    expect(createdEditors[0].setScrollTop).not.toHaveBeenCalled();
  });

  it("reads file content via readTextFile", async () => {
    await codeRenderer.mount(container, { path: "/proj/main.ts" });

    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    expect(readTextFile).toHaveBeenCalledWith("/proj/main.ts");
  });
});
