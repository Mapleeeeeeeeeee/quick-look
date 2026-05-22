// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectFileType } from "./renderer";

const mockRenderer = vi.hoisted(() => ({
  mount: vi.fn().mockResolvedValue(undefined),
  unmount: vi.fn(),
}));

vi.mock("./renderers/code-renderer", () => ({
  codeRenderer: mockRenderer,
}));

vi.mock("./renderers/markdown-renderer", () => ({
  markdownRenderer: mockRenderer,
}));

vi.mock("./renderers/image-renderer", () => ({
  imageRenderer: mockRenderer,
}));

describe("detectFileType", () => {
  it.each([
    ["markdown", "README.md"],
    ["markdown", "doc.mdx"],
    ["code", "main.ts"],
    ["code", "script.py"],
    ["code", "lib.rs"],
    ["image", "image.png"],
    ["image", "photo.jpg"],
    ["image", "photo.jpeg"],
    ["image", "icon.svg"],
    ["image", "pic.gif"],
    ["image", "pic.webp"],
    ["image", "pic.ico"],
    ["image", "pic.bmp"],
    ["code", "Makefile"],
    ["code", "data.xyz"],
    ["code", "INDEX.HTML"],
  ])("returns %s type when given %s", (expected, filename) => {
    expect(detectFileType(`/path/to/${filename}`)).toBe(expected);
  });
});

describe("renderFile", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="monaco-container" style="display: none"></div>
      <div id="content-container" style="display: none"></div>
    `;
    mockRenderer.mount.mockClear();
    mockRenderer.unmount.mockClear();
  });

  it("shows monaco container and hides content container for code files", async () => {
    const { renderFile } = await import("./renderer");
    await renderFile({ path: "/proj/main.ts" });

    const monacoContainer = document.getElementById("monaco-container")!;
    const contentContainer = document.getElementById("content-container")!;
    expect(monacoContainer.style.display).toBe("block");
    expect(contentContainer.style.display).toBe("none");
  });

  it("shows content container and hides monaco for markdown files", async () => {
    const { renderFile } = await import("./renderer");
    await renderFile({ path: "/proj/README.md" });

    const monacoContainer = document.getElementById("monaco-container")!;
    const contentContainer = document.getElementById("content-container")!;
    expect(contentContainer.style.display).toBe("block");
    expect(monacoContainer.style.display).toBe("none");
    expect(mockRenderer.mount).toHaveBeenCalled();
  });

  it("shows content container and hides monaco for image files", async () => {
    const { renderFile } = await import("./renderer");
    await renderFile({ path: "/proj/logo.png" });

    const monacoContainer = document.getElementById("monaco-container")!;
    const contentContainer = document.getElementById("content-container")!;
    expect(contentContainer.style.display).toBe("block");
    expect(monacoContainer.style.display).toBe("none");
  });

  it("unmounts previous renderer before mounting new one", async () => {
    const { renderFile } = await import("./renderer");
    await renderFile({ path: "/proj/a.ts" });

    const callOrder: string[] = [];
    mockRenderer.unmount.mockImplementation(() => {
      callOrder.push("unmount");
    });
    mockRenderer.mount.mockImplementation(async () => {
      callOrder.push("mount");
    });

    await renderFile({ path: "/proj/b.ts" });

    expect(callOrder).toEqual(["unmount", "mount"]);
  });

  it("passes FileRequest to renderer mount", async () => {
    const { renderFile } = await import("./renderer");
    const req = { path: "/proj/main.ts", startLine: 5, endLine: 10 };
    await renderFile(req);

    const monacoContainer = document.getElementById("monaco-container")!;
    expect(mockRenderer.mount).toHaveBeenCalledWith(monacoContainer, req);
  });
});
