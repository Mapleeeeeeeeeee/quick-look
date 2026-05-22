import './styles/main.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setupKeyboard, setupDragRegion } from './keyboard';
import type { FileRequest } from './types';
import { renderFile } from './renderer';

function updateTitle(request: FileRequest): void {
  const titleEl = document.getElementById('title');
  if (titleEl) {
    const filename = request.path.split('/').pop() ?? request.path;
    titleEl.textContent = filename;
  }
}

async function handleFileRequest(request: FileRequest): Promise<void> {
  updateTitle(request);
  await renderFile(request);
}

async function init(): Promise<void> {
  setupKeyboard();
  setupDragRegion();

  await listen<FileRequest>('new-file-request', (event) => {
    handleFileRequest(event.payload);
  });

  const initialRequest = await invoke<FileRequest | null>('get_initial_request');
  if (initialRequest) {
    await handleFileRequest(initialRequest);
  }
}

init();
