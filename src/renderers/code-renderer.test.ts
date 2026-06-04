// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type FakeEditor = {
  setModel: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  deltaDecorations: ReturnType<typeof vi.fn>;
  getTopForLineNumber: ReturnType<typeof vi.fn>;
  setScrollTop: ReturnType<typeof vi.fn>;
  saveViewState: ReturnType<typeof vi.fn>;
  restoreViewState: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  getAction: ReturnType<typeof vi.fn>;
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
    saveViewState: vi.fn().mockReturnValue({
      cursorState: [],
      viewState: { scrollTop: 42 },
    }),
    restoreViewState: vi.fn(),
    dispose: vi.fn(),
    getAction: vi.fn().mockReturnValue({ run: vi.fn() }),
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
      createModel: vi.fn((content: string, lang: string) => {
        let disposed = false;
        let currentContent = content;
        return {
          content,
          lang,
          getValue: vi.fn(() => currentContent),
          setValue: vi.fn((c: string) => {
            currentContent = c;
          }),
          dispose: vi.fn(() => {
            disposed = true;
          }),
          isDisposed: vi.fn(() => disposed),
        };
      }),
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

const mockFetch = vi.fn().mockResolvedValue({
  text: () => Promise.resolve("file content here"),
});

vi.stubGlobal("fetch", mockFetch);

import { detectLanguage, codeRenderer, triggerFind } from "./code-renderer";

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
    mockFetch.mockClear();
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

  it("clears old decorations but does not restore view state on fresh mount without startLine", async () => {
    await codeRenderer.mount(container, {
      path: "/proj/fresh-no-startline.ts",
    });

    expect(createdEditors[0].deltaDecorations).toHaveBeenCalledWith([], []);
    expect(createdEditors[0].setScrollTop).not.toHaveBeenCalled();
    expect(createdEditors[0].restoreViewState).not.toHaveBeenCalled();
  });

  it("reads file content via fetch with file:// URL", async () => {
    await codeRenderer.mount(container, { path: "/proj/main.ts" });

    expect(mockFetch).toHaveBeenCalledWith("file:///proj/main.ts");
  });
});

describe("view state preservation", () => {
  let container: HTMLElement;

  beforeEach(() => {
    createdEditors.length = 0;
    mockFetch.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    codeRenderer.unmount();
  });

  afterEach(() => {
    codeRenderer.unmount();
    document.body.removeChild(container);
  });

  it("saves view state before switching to a different file", async () => {
    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    const editor = createdEditors[0];
    editor.saveViewState.mockClear();

    await codeRenderer.mount(container, { path: "/proj/b.ts" });

    expect(editor.saveViewState).toHaveBeenCalledTimes(1);
  });

  it("restores saved view state when switching back to a previously viewed file without startLine", async () => {
    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    const editor = createdEditors[0];
    const expectedState = { cursorState: [], viewState: { scrollTop: 42 } };

    await codeRenderer.mount(container, { path: "/proj/b.ts" });
    editor.restoreViewState.mockClear();

    await codeRenderer.mount(container, { path: "/proj/a.ts" });

    expect(editor.restoreViewState).toHaveBeenCalledWith(expectedState);
  });

  it("does not restore view state when startLine is provided", async () => {
    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    const editor = createdEditors[0];

    await codeRenderer.mount(container, { path: "/proj/b.ts" });
    editor.restoreViewState.mockClear();
    editor.deltaDecorations.mockClear();
    editor.setScrollTop.mockClear();

    await codeRenderer.mount(container, { path: "/proj/a.ts", startLine: 10 });

    expect(editor.restoreViewState).not.toHaveBeenCalled();
    expect(editor.deltaDecorations).toHaveBeenCalled();
    expect(editor.setScrollTop).toHaveBeenCalled();
  });

  it("reuses cached model for the same file path instead of creating a new one", async () => {
    const { editor: monacoEditor } = await import("monaco-editor");
    const createModelMock = monacoEditor.createModel as ReturnType<
      typeof vi.fn
    >;
    const callsBefore = createModelMock.mock.results.length;

    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    // Grab the model object returned by createModel for a.ts
    const firstModel = createModelMock.mock.results[callsBefore].value;

    await codeRenderer.mount(container, { path: "/proj/b.ts" });
    const createModelCallCount = createModelMock.mock.calls.length;

    await codeRenderer.mount(container, { path: "/proj/a.ts" });

    // createModel should NOT have been called again for a.ts
    expect(createModelMock.mock.calls.length).toBe(createModelCallCount);
    // The editor should receive the same model object from the first mount
    expect(createdEditors[0].setModel).toHaveBeenLastCalledWith(firstModel);
  });

  it("disposes all cached models on unmount", async () => {
    const { editor: monacoEditor } = await import("monaco-editor");

    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    await codeRenderer.mount(container, { path: "/proj/b.ts" });

    const calls = (monacoEditor.createModel as ReturnType<typeof vi.fn>).mock
      .results;
    const models = calls.slice(-2).map((r: { value: unknown }) => r.value) as {
      dispose: ReturnType<typeof vi.fn>;
      isDisposed: ReturnType<typeof vi.fn>;
    }[];

    codeRenderer.unmount();

    for (const model of models) {
      expect(model.dispose).toHaveBeenCalled();
    }
  });

  it("clears viewStates on unmount so stale scroll positions are not restored after remount", async () => {
    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    await codeRenderer.mount(container, { path: "/proj/b.ts" });
    codeRenderer.unmount();

    await codeRenderer.mount(container, { path: "/proj/a.ts" });

    expect(createdEditors[1].restoreViewState).not.toHaveBeenCalled();
  });

  it("saves view state during unmount to preserve last-viewed scroll position", async () => {
    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    const editor = createdEditors[0];
    editor.saveViewState.mockClear();

    codeRenderer.unmount();

    expect(editor.saveViewState).toHaveBeenCalledTimes(1);
  });

  it("updates cached model content when file changes on disk between tab switches", async () => {
    const { editor: monacoEditor } = await import("monaco-editor");
    const createModelMock = monacoEditor.createModel as ReturnType<
      typeof vi.fn
    >;

    await codeRenderer.mount(container, { path: "/proj/a.ts" });
    const results = createModelMock.mock.results;
    const modelA = results[results.length - 1]!.value as {
      setValue: ReturnType<typeof vi.fn>;
    };

    mockFetch.mockResolvedValueOnce({
      text: () => Promise.resolve("updated content"),
    });
    await codeRenderer.mount(container, { path: "/proj/b.ts" });

    mockFetch.mockResolvedValueOnce({
      text: () => Promise.resolve("updated content"),
    });
    await codeRenderer.mount(container, { path: "/proj/a.ts" });

    expect(modelA.setValue).toHaveBeenCalledWith("updated content");
  });

  it("clears old decorations when switching to a file without startLine", async () => {
    const editor = makeEditor();
    editor.deltaDecorations.mockReturnValue(["deco-1"]);
    createdEditors.push(editor);
    const { editor: monacoEditor } = await import("monaco-editor");
    (monacoEditor.create as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      editor,
    );

    await codeRenderer.mount(container, {
      path: "/proj/deco-a.ts",
      startLine: 10,
      endLine: 20,
    });
    editor.deltaDecorations.mockClear();

    await codeRenderer.mount(container, { path: "/proj/deco-b.ts" });

    expect(editor.deltaDecorations).toHaveBeenCalledWith(["deco-1"], []);
  });
});

describe("triggerFind", () => {
  let container: HTMLElement;

  beforeEach(() => {
    createdEditors.length = 0;
    mockFetch.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    codeRenderer.unmount();
  });

  afterEach(() => {
    codeRenderer.unmount();
    document.body.removeChild(container);
  });

  it('calls getAction with "actions.find" and runs it when editor exists', async () => {
    await codeRenderer.mount(container, { path: "/proj/main.ts" });
    const editor = createdEditors[0];
    const fakeAction = { run: vi.fn() };
    editor.getAction.mockReturnValue(fakeAction);

    triggerFind();

    expect(editor.getAction).toHaveBeenCalledWith("actions.find");
    expect(fakeAction.run).toHaveBeenCalledTimes(1);
  });

  it("does not throw when called before any editor is mounted", () => {
    expect(() => triggerFind()).not.toThrow();
  });
});
