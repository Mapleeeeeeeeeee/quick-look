import "../styles/markdown.css";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { FileRequest, Renderer } from "../types";
import { createColorizedCodeBlock } from "./code-renderer";

const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);

let container: HTMLElement | null = null;

function isYamlFile(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return YAML_EXTENSIONS.has(ext);
}

async function createRenderedContent(
  req: FileRequest,
  content: string,
): Promise<HTMLElement> {
  const rendered = document.createElement("div");
  rendered.className = "md-rendered";

  if (isYamlFile(req.path)) {
    rendered.appendChild(await createColorizedCodeBlock(req.path, content));
    return rendered;
  }

  const rawHtml = marked.parse(content) as string;
  rendered.innerHTML = DOMPurify.sanitize(rawHtml);
  return rendered;
}

export const markdownRenderer: Renderer = {
  async mount(el: HTMLElement, req: FileRequest): Promise<void> {
    container = el;

    const response = await fetch(`file://${req.path}`);
    const content = await response.text();
    const rendered = await createRenderedContent(req, content);

    const toolbar = document.createElement("div");
    toolbar.className = "md-toolbar";

    const toggle = document.createElement("button");
    toggle.className = "md-toggle";
    toggle.type = "button";
    toggle.textContent = "Raw";
    toolbar.appendChild(toggle);

    const raw = document.createElement("pre");
    raw.className = "md-raw";
    raw.style.display = "none";
    raw.textContent = content;

    toggle.addEventListener("click", () => {
      const isShowingRendered = raw.style.display === "none";
      if (isShowingRendered) {
        rendered.style.display = "none";
        raw.style.display = "";
        toggle.textContent = "Preview";
        return;
      }

      raw.style.display = "none";
      rendered.style.display = "";
      toggle.textContent = "Raw";
    });

    container.innerHTML = "";
    container.appendChild(toolbar);
    container.appendChild(rendered);
    container.appendChild(raw);
  },

  unmount(): void {
    if (container) {
      container.innerHTML = "";
      container = null;
    }
  },
};
