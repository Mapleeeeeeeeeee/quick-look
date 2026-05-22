import type { FileRequest, Renderer } from "./types";

export type { FileRequest };

export function detectFileType(
  filePath: string,
): "code" | "markdown" | "image" {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  if (ext === ".md" || ext === ".mdx") return "markdown";
  if (
    [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp"].includes(
      ext,
    )
  )
    return "image";
  return "code";
}

let currentRenderer: Renderer | null = null;

export async function renderFile(req: FileRequest): Promise<void> {
  const monacoContainer = document.getElementById("monaco-container")!;
  const contentContainer = document.getElementById("content-container")!;

  if (currentRenderer) {
    currentRenderer.unmount();
  }

  const fileType = detectFileType(req.path);

  if (fileType === "code") {
    const { codeRenderer } = await import("./renderers/code-renderer");
    monacoContainer.style.display = "block";
    contentContainer.style.display = "none";
    currentRenderer = codeRenderer;
    await codeRenderer.mount(monacoContainer, req);
  } else if (fileType === "markdown") {
    const { markdownRenderer } = await import('./renderers/markdown-renderer');
    monacoContainer.style.display = "none";
    contentContainer.style.display = "block";
    currentRenderer = markdownRenderer;
    await markdownRenderer.mount(contentContainer, req);
  } else if (fileType === "image") {
    const { imageRenderer } = await import('./renderers/image-renderer');
    monacoContainer.style.display = 'none';
    contentContainer.style.display = 'block';
    currentRenderer = imageRenderer;
    await imageRenderer.mount(contentContainer, req);
  }
}
