// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("./code-renderer", () => ({
  createColorizedCodeBlock: vi.fn(async (_filePath: string, content: string) => {
    const pre = document.createElement("pre");
    pre.className = "md-code-preview";

    const code = document.createElement("code");
    code.className = "md-code-preview__content";
    code.setAttribute("data-lang", "yaml");
    const span = document.createElement("span");
    span.className = "mtk1";
    span.textContent = content;
    code.appendChild(span);
    pre.appendChild(code);

    return pre;
  }),
}));

import { markdownRenderer } from "./markdown-renderer";

describe("markdownRenderer", () => {
  let container: HTMLElement;

  beforeEach(() => {
    mockFetch.mockReset();
    markdownRenderer.unmount();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("test_given_markdown_file_when_mount_then_renders_markdown_html_and_raw_toggle", async () => {
    mockFetch.mockResolvedValue({
      text: () => Promise.resolve("# Title\n\nBody"),
    });

    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    const toolbarButton =
      container.querySelector<HTMLButtonElement>(".md-toggle");
    const rendered = container.querySelector<HTMLElement>(".md-rendered");
    const raw = container.querySelector<HTMLElement>(".md-raw");

    expect(toolbarButton?.textContent).toBe("Raw");
    expect(rendered?.innerHTML).toContain("<h1>Title</h1>");
    expect(rendered?.textContent).toContain("Body");
    expect(raw?.textContent).toBe("# Title\n\nBody");
    expect(raw?.style.display).toBe("none");

    toolbarButton?.click();

    expect(toolbarButton?.textContent).toBe("Preview");
    expect(rendered?.style.display).toBe("none");
    expect(raw?.style.display).toBe("");
  });

  it("test_given_yaml_file_when_mount_then_renders_readable_code_block_preview", async () => {
    // Guards the reported bug where .yaml/.yml fell back to raw code view instead of rendered preview.
    mockFetch.mockResolvedValue({
      text: () => Promise.resolve("name: quick-look\nenabled: true"),
    });

    await markdownRenderer.mount(container, { path: "/proj/config.yaml" });

    const rendered = container.querySelector<HTMLElement>(".md-rendered");
    const codeBlock = container.querySelector<HTMLElement>(
      ".md-rendered pre code",
    );
    const raw = container.querySelector<HTMLElement>(".md-raw");

    expect(rendered).not.toBeNull();
    expect(codeBlock?.textContent).toContain("name: quick-look");
    expect(codeBlock?.textContent).toContain("enabled: true");
    expect(raw?.textContent).toBe("name: quick-look\nenabled: true");
  });
});
