import './styles/main.css';
import { listen } from '@tauri-apps/api/event';
import { setupKeyboard, setupDragRegion } from './keyboard';

interface FileRequest {
  path: string;
  start_line?: number;
  end_line?: number;
}

function handleFileRequest(request: FileRequest): void {
  const titleEl = document.getElementById('title');
  if (titleEl) {
    const filename = request.path.split('/').pop() ?? request.path;
    titleEl.textContent = filename;
  }
  // Phase 4+ 會加 renderer dispatch，現在先 console.log
  console.log('File request received:', request);
}

async function init(): Promise<void> {
  setupKeyboard();
  setupDragRegion();

  await listen<FileRequest>('file-ready', (event) => {
    handleFileRequest(event.payload);
  });

  await listen<FileRequest>('new-file-request', (event) => {
    handleFileRequest(event.payload);
  });
}

init();
