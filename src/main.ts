import './styles/main.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setupKeyboard, setupDragRegion } from './keyboard';

interface FileRequest {
  path: string;
  startLine?: number;
  endLine?: number;
}

function handleFileRequest(request: FileRequest): void {
  const titleEl = document.getElementById('title');
  if (titleEl) {
    const filename = request.path.split('/').pop() ?? request.path;
    titleEl.textContent = filename;
  }
  console.log('File request received:', request);
}

async function init(): Promise<void> {
  setupKeyboard();
  setupDragRegion();

  await listen<FileRequest>('new-file-request', (event) => {
    handleFileRequest(event.payload);
  });

  const initialRequest = await invoke<FileRequest | null>('get_initial_request');
  if (initialRequest) {
    handleFileRequest(initialRequest);
  }
}

init();
