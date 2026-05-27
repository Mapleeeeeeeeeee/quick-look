import "./styles/main.css";
import type { FileRequest } from "./types";
import { renderFile, resetRenderer } from "./renderer";

interface Tab {
  id: string;
  path: string;
  startLine?: number;
  endLine?: number;
}

let tabs: Tab[] = [];
let activeTabId: string | null = null;

function generateTabId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getFilename(path: string): string {
  return path.split("/").pop() ?? path;
}

function updateTitle(path: string): void {
  const titleEl = document.getElementById("title");
  if (titleEl) {
    titleEl.textContent = getFilename(path);
  }
}

function updateContentHeight(): void {
  const hasTabBar = tabs.length > 1;
  const height = hasTabBar ? "calc(100% - 32px - 32px)" : "calc(100% - 32px)";
  const monacoContainer = document.getElementById("monaco-container");
  const contentContainer = document.getElementById("content-container");
  if (monacoContainer) monacoContainer.style.height = height;
  if (contentContainer) contentContainer.style.height = height;
}

function setupTabBarDelegation(): void {
  const tabBar = document.getElementById("tab-bar");
  if (!tabBar) return;

  tabBar.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const tabEl = target.closest(".tab") as HTMLElement | null;
    if (!tabEl) return;

    const tabId = tabEl.dataset["tabId"];
    if (!tabId) return;

    if (target.closest(".tab-close")) {
      closeTab(tabId);
    } else {
      void switchTab(tabId);
    }
  });
}

function renderTabBar(): void {
  const tabBar = document.getElementById("tab-bar");
  if (!tabBar) return;

  while (tabBar.firstChild) {
    tabBar.removeChild(tabBar.firstChild);
  }
  tabBar.style.display = tabs.length > 1 ? "flex" : "none";

  for (const tab of tabs) {
    const tabEl = document.createElement("div");
    tabEl.className = `tab${tab.id === activeTabId ? " active" : ""}`;
    tabEl.dataset["tabId"] = tab.id;

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = getFilename(tab.path);

    const closeBtn = document.createElement("span");
    closeBtn.className = "tab-close";
    closeBtn.textContent = "×";

    tabEl.appendChild(label);
    tabEl.appendChild(closeBtn);
    tabBar.appendChild(tabEl);
  }

  updateContentHeight();
}

async function switchTab(tabId: string): Promise<void> {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;

  activeTabId = tabId;
  renderTabBar();
  updateTitle(tab.path);

  try {
    await renderFile(tab);
  } catch (err) {
    closeTab(tabId);
    const titleEl = document.getElementById("title");
    if (titleEl) {
      titleEl.textContent = `Error: ${err instanceof Error ? err.message : "Failed to load file"}`;
    }
  }
}

function showEmptyState(): void {
  const monacoContainer = document.getElementById("monaco-container");
  const contentContainer = document.getElementById("content-container");
  if (monacoContainer) monacoContainer.style.display = "none";
  if (contentContainer) contentContainer.style.display = "none";

  const titleEl = document.getElementById("title");
  if (titleEl) titleEl.textContent = "File Preview";
}

function closeTab(tabId: string): void {
  const index = tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return;

  tabs.splice(index, 1);

  if (tabs.length === 0) {
    activeTabId = null;
    resetRenderer();
    renderTabBar();
    showEmptyState();
    return;
  }

  if (activeTabId === tabId) {
    const newIndex = Math.min(index, tabs.length - 1);
    void switchTab(tabs[newIndex]!.id);
  } else {
    renderTabBar();
  }
}

async function handleFileRequest(request: FileRequest): Promise<void> {
  // If a tab with the same path is already open, update its line range and switch to it
  const existing = tabs.find((t) => t.path === request.path);
  if (existing) {
    existing.startLine = request.startLine;
    existing.endLine = request.endLine;
    await switchTab(existing.id);
    return;
  }

  const tab: Tab = {
    id: generateTabId(),
    path: request.path,
    startLine: request.startLine,
    endLine: request.endLine,
  };

  tabs.push(tab);
  activeTabId = tab.id;
  renderTabBar();
  updateTitle(tab.path);

  try {
    await renderFile(tab);
  } catch (err) {
    closeTab(tab.id);
    const titleEl = document.getElementById("title");
    if (titleEl) {
      titleEl.textContent = `Error: ${err instanceof Error ? err.message : "Failed to load file"}`;
    }
  }
}

function cycleTab(): void {
  if (tabs.length <= 1) return;
  const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
  const nextIndex = (currentIndex + 1) % tabs.length;
  void switchTab(tabs[nextIndex]!.id);
}

(window as any).handleFileRequest = handleFileRequest;
(window as any).cycleTab = cycleTab;

setupTabBarDelegation();

document.getElementById("close-btn")?.addEventListener("click", () => {
  (window as any).webkit?.messageHandlers?.close?.postMessage(null);
});
