// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../styles/markdown.css", () => ({}));

vi.mock("marked", () => ({
  marked: {
    parse: vi.fn(
      (content: string) =>
        `<p>Hello</p><p><a href="https://github.com">GitHub</a></p><p><a href="http://example.com">Example</a></p><p><a href="#section">Anchor</a></p><p><a>No href</a></p>`,
    ),
  },
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((html: string) => html),
  },
}));

const mockFetch = vi.fn().mockResolvedValue({
  text: () => Promise.resolve("# Hello\n[GitHub](https://github.com)"),
});
vi.stubGlobal("fetch", mockFetch);

import { markdownRenderer } from "./markdown-renderer";

describe("markdownRenderer", () => {
  let container: HTMLElement;

  beforeEach(() => {
    mockFetch.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    markdownRenderer.unmount();
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  it("fetches file content via file:// URL", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    expect(mockFetch).toHaveBeenCalledWith("file:///proj/README.md");
  });

  it("renders toolbar, rendered content, and raw content", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    expect(container.querySelector(".md-toolbar")).not.toBeNull();
    expect(container.querySelector(".md-rendered")).not.toBeNull();
    expect(container.querySelector(".md-raw")).not.toBeNull();
  });

  it("shows rendered view by default and hides raw", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    const rendered = container.querySelector(".md-rendered") as HTMLElement;
    const raw = container.querySelector(".md-raw") as HTMLElement;
    expect(raw.style.display).toBe("none");
    expect(rendered.style.display).not.toBe("none");
  });

  it("toggles between Raw and Preview views", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    const toggle = container.querySelector(".md-toggle") as HTMLButtonElement;
    const rendered = container.querySelector(".md-rendered") as HTMLElement;
    const raw = container.querySelector(".md-raw") as HTMLElement;

    // Click to switch to Raw
    toggle.click();
    expect(raw.style.display).toBe("");
    expect(rendered.style.display).toBe("none");
    expect(toggle.textContent).toBe("Preview");

    // Click to switch back to Preview
    toggle.click();
    expect(raw.style.display).toBe("none");
    expect(rendered.style.display).toBe("");
    expect(toggle.textContent).toBe("Raw");
  });

  it("clears container on unmount", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });
    expect(container.innerHTML).not.toBe("");

    markdownRenderer.unmount();
    expect(container.innerHTML).toBe("");
  });

  it("does not throw on unmount without prior mount", () => {
    expect(() => markdownRenderer.unmount()).not.toThrow();
  });
});

describe("markdownRenderer link interception", () => {
  let container: HTMLElement;
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);

    // Set up the webkit message handler mock
    mockPostMessage = vi.fn();
    (window as any).webkit = {
      messageHandlers: {
        openExternal: {
          postMessage: mockPostMessage,
        },
      },
    };
  });

  afterEach(() => {
    markdownRenderer.unmount();
    if (container.parentNode) {
      document.body.removeChild(container);
    }
    delete (window as any).webkit;
  });

  it("given rendered markdown with links, when clicking an https link, then default navigation is prevented", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    const link = container.querySelector(
      'a[href="https://github.com"]',
    ) as HTMLAnchorElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    link.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("given rendered markdown with links, when clicking an https link, then URL is sent to webkit openExternal handler", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    const link = container.querySelector(
      'a[href="https://github.com"]',
    ) as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(mockPostMessage).toHaveBeenCalledWith("https://github.com");
  });

  it("given rendered markdown with links, when clicking an http link, then URL is sent to webkit openExternal handler", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    const link = container.querySelector(
      'a[href="http://example.com"]',
    ) as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(mockPostMessage).toHaveBeenCalledWith("http://example.com");
  });

  it("given rendered markdown with anchor links, when clicking an anchor link, then openExternal handler is not called", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    const link = container.querySelector(
      'a[href="#section"]',
    ) as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("given no webkit handler available, when clicking an external link, then no error is thrown", async () => {
    delete (window as any).webkit;
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    const link = container.querySelector(
      'a[href="https://github.com"]',
    ) as HTMLAnchorElement;

    expect(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }).not.toThrow();
  });

  it("given rendered markdown, when clicking a non-link element, then no interception occurs", async () => {
    await markdownRenderer.mount(container, { path: "/proj/README.md" });

    const paragraph = container.querySelector("p") as HTMLElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    paragraph.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
});
