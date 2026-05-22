export interface FileRequest {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface Renderer {
  mount(container: HTMLElement, req: FileRequest): Promise<void>;
  unmount(): void;
}
