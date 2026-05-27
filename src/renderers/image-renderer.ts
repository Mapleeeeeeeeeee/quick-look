import type { FileRequest, Renderer } from '../types';

let container: HTMLElement | null = null;

export const imageRenderer: Renderer = {
  async mount(el: HTMLElement, req: FileRequest): Promise<void> {
    container = el;
    container.innerHTML = '';

    const filename = req.path.substring(req.path.lastIndexOf('/') + 1);

    const img = document.createElement('img');
    img.src = `file://${req.path}`;
    img.alt = filename;
    img.style.objectFit = 'contain';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.transformOrigin = 'center center';

    let scale = 1;

    img.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (event.deltaY < 0) {
        scale = Math.min(scale * 1.1, 10);
      } else {
        scale = Math.max(scale / 1.1, 0.1);
      }
      img.style.transform = `scale(${scale})`;
    });

    container.appendChild(img);
  },

  unmount(): void {
    if (container) {
      container.innerHTML = '';
      container = null;
    }
  },
};
