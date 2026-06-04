import "../styles/markdown.css";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { FileRequest, Renderer } from "../types";

const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);
const YAML_CODE_FENCE = "```";

let container: HTMLElement | null = null;

function isYamlFile(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return YAML_EXTENSIONS.has(ext);
}

function getRenderedSource(req: FileRequest, content: string): string {
  if (isYamlFile(req.path)) {
    return `${YAML_CODE_FENCE}yaml\n${content}\n${YAML_CODE_FENCE}`;
  }

  return content;
}

export const markdownRenderer: Renderer = {
  async mount(el: HTMLElement, req: FileRequest): Promise<void> {
    container = el;

    const response = await fetch(`file://${req.path}`);
    const content = await response.text();
    const rawHtml = marked.parse(getRenderedSource(req, content)) as string;
    const safeHtml = DOMPurify.sanitize(rawHtml);

    const toolbar = document.createElement("div");
    toolbar.className = "md-toolbar";

    const toggle = document.createElement("button");
    toggle.className = "md-toggle";
    toggle.type = "button";
    toggle.textContent = "Raw";
    toolbar.appendChild(toggle);

    const rendered = document.createElement("div");
    rendered.className = "md-rendered";
    rendered.innerHTML = safeHtml;

    const raw = document.createElement("pre");
    raw.className = "md-raw";
    raw.style.display = "none";
    raw.textContent = content;

    toggle.addEventListener("click", () => {
      const showingRendered = raw.style.display === "none";
      if (showingRendered) {
        rendered.style.display = "none";
        raw.style.display = "";
        toggle.textContent = "Preview";
      } else {
        raw.style.display = "none";
        rendered.style.display = "";
        toggle.textContent = "Raw";
      }
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
