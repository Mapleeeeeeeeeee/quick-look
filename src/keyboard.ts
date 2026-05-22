import { getCurrentWindow } from "@tauri-apps/api/window";

export function setupKeyboard(): void {
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      getCurrentWindow().close();
    }
  });
}

export function setupDragRegion(): void {
  const header = document.getElementById("header");
  if (!header) return;

  header.addEventListener("mousedown", (event: MouseEvent) => {
    if (event.button === 0) {
      getCurrentWindow().startDragging();
    }
  });
}
