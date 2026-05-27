// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRenderFile = vi.fn().mockResolvedValue(undefined);
const mockResetRenderer = vi.fn();
const mockGetCurrentFileType = vi.fn().mockReturnValue("code");

vi.mock("./renderer", () => ({
  renderFile: (...args: unknown[]) => mockRenderFile(...args),
  resetRenderer: () => mockResetRenderer(),
  getCurrentFileType: () => mockGetCurrentFileType(),
}));

const BASE_DOM = `
  <div id="header"><span id="title">File Preview</span><button id="close-btn"></button></div>
  <div id="tab-bar"></div>
  <div id="monaco-container" style="display: none"></div>
  <div id="content-container" style="display: none"></div>
`;

async function importMain() {
  await import("./main");
}

describe("tab management", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRenderFile.mockClear();
    mockResetRenderer.mockClear();
    mockGetCurrentFileType.mockClear().mockReturnValue("code");
    document.body.innerHTML = BASE_DOM;

    // Clean up window functions from previous imports
    delete (window as any).handleFileRequest;
    delete (window as any).cycleTab;
    delete (window as any).triggerSearch;
  });

  describe("handleFileRequest", () => {
    it("adds a new tab and renders the file when path is new", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;

      await handleFileRequest({ path: "/proj/main.ts" });

      const titleEl = document.getElementById("title")!;
      expect(titleEl.textContent).toBe("main.ts");
      expect(mockRenderFile).toHaveBeenCalledTimes(1);
      expect(mockRenderFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/proj/main.ts" }),
      );
    });

    it("switches to existing tab when same path is requested again — only 1 tab created", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;

      await handleFileRequest({ path: "/proj/main.ts" });
      await handleFileRequest({ path: "/proj/main.ts" });

      const tabBar = document.getElementById("tab-bar")!;
      const tabElements = tabBar.querySelectorAll(".tab");
      // A single tab should not create duplicate DOM entries.
      // With 1 tab the tab bar is hidden, so 1 .tab element exists but bar is display:none.
      expect(tabElements.length).toBe(1);
      expect(mockRenderFile).toHaveBeenCalledTimes(2);
      expect(document.getElementById("title")!.textContent).toBe("main.ts");
    });

    it("updates line range when switching to existing tab", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;

      await handleFileRequest({
        path: "/proj/main.ts",
        startLine: 1,
        endLine: 10,
      });
      await handleFileRequest({
        path: "/proj/main.ts",
        startLine: 50,
        endLine: 60,
      });

      // The second renderFile call should carry the updated line range
      const secondCall = mockRenderFile.mock.calls[1]![0] as {
        path: string;
        startLine?: number;
        endLine?: number;
      };
      expect(secondCall.startLine).toBe(50);
      expect(secondCall.endLine).toBe(60);
    });

    it("removes tab and shows error in title when renderFile rejects", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;

      mockRenderFile.mockRejectedValueOnce(new Error("ENOENT"));
      await handleFileRequest({ path: "/proj/missing.ts" });

      const tabBar = document.getElementById("tab-bar")!;
      expect(tabBar.querySelectorAll(".tab").length).toBe(0);
      expect(document.getElementById("title")!.textContent).toContain("Error");
    });
  });

  describe("cycleTab", () => {
    it("cycles to next tab when multiple tabs are open", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;
      const cycleTab = (window as any).cycleTab;

      await handleFileRequest({ path: "/proj/a.ts" });
      await handleFileRequest({ path: "/proj/b.ts" });
      await handleFileRequest({ path: "/proj/c.ts" });

      // Active tab is c.ts (last opened). Cycling should go to a.ts (index 0 wraps from 2→0? No: (2+1)%3=0).
      // Actually: a=0, b=1, c=2 (active). (2+1)%3 = 0 → a.ts
      cycleTab();

      const titleEl = document.getElementById("title")!;
      expect(titleEl.textContent).toBe("a.ts");
    });

    it("wraps around to first tab after last", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;
      const cycleTab = (window as any).cycleTab;

      await handleFileRequest({ path: "/proj/a.ts" });
      await handleFileRequest({ path: "/proj/b.ts" });

      // Active is b.ts (index 1). (1+1)%2 = 0 → a.ts
      cycleTab();
      expect(document.getElementById("title")!.textContent).toBe("a.ts");

      // Now active is a.ts (index 0). (0+1)%2 = 1 → b.ts
      cycleTab();
      expect(document.getElementById("title")!.textContent).toBe("b.ts");
    });

    it("does nothing when only one tab is open", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;
      const cycleTab = (window as any).cycleTab;

      await handleFileRequest({ path: "/proj/solo.ts" });
      mockRenderFile.mockClear();

      cycleTab();

      // renderFile should not be called again — cycleTab early-returns for single tab
      expect(mockRenderFile).not.toHaveBeenCalled();
      expect(document.getElementById("title")!.textContent).toBe("solo.ts");
    });
  });

  describe("closeTab", () => {
    it("calls resetRenderer when last tab is closed and shows empty state", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;

      await handleFileRequest({ path: "/proj/only.ts" });

      const closeBtn = document.querySelector(".tab-close") as HTMLElement;
      closeBtn.click();

      // Allow microtasks to settle (switchTab is async)
      await vi.waitFor(() => {
        expect(mockResetRenderer).toHaveBeenCalledTimes(1);
      });
      expect(document.getElementById("title")!.textContent).toBe(
        "File Preview",
      );
    });

    it("switches to adjacent tab when active tab is closed", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;

      await handleFileRequest({ path: "/proj/a.ts" });
      await handleFileRequest({ path: "/proj/b.ts" });

      // b.ts is active (last opened). Its close button is the second .tab-close.
      const closeBtns = document.querySelectorAll(".tab-close");
      const bCloseBtn = closeBtns[1] as HTMLElement;
      bCloseBtn.click();

      // After closing b.ts, a.ts should become active
      await vi.waitFor(() => {
        expect(document.getElementById("title")!.textContent).toBe("a.ts");
      });
    });

    it("leaves active tab unchanged when closing a non-active tab", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;

      await handleFileRequest({ path: "/proj/a.ts" });
      await handleFileRequest({ path: "/proj/b.ts" });

      // b.ts is active. Close a.ts (the non-active tab, first .tab-close).
      const closeBtns = document.querySelectorAll(".tab-close");
      (closeBtns[0] as HTMLElement).click();

      await vi.waitFor(() => {
        expect(document.querySelectorAll(".tab").length).toBe(1);
      });
      expect(document.getElementById("title")!.textContent).toBe("b.ts");
    });
  });

  describe("tab bar rendering", () => {
    it("hides tab bar when only one tab is open", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;

      await handleFileRequest({ path: "/proj/single.ts" });

      const tabBar = document.getElementById("tab-bar")!;
      expect(tabBar.style.display).toBe("none");
    });

    it("shows tab bar when two or more tabs are open", async () => {
      await importMain();
      const handleFileRequest = (window as any).handleFileRequest;

      await handleFileRequest({ path: "/proj/a.ts" });
      await handleFileRequest({ path: "/proj/b.ts" });

      const tabBar = document.getElementById("tab-bar")!;
      expect(tabBar.style.display).toBe("flex");
    });
  });
});
