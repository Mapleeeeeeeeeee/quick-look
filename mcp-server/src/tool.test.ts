import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const listeners: Record<string, Function> = {};
    const child = {
      on: vi.fn((event: string, cb: Function) => {
        listeners[event] = cb;
        if (event === 'spawn') {
          queueMicrotask(() => cb());
        }
      }),
      unref: vi.fn(),
    };
    return child;
  }),
}));

import { stat, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createShowFileTool } from './tool.js';
import { UserError } from 'fastmcp';

const mockStat = vi.mocked(stat);
const mockReadFile = vi.mocked(readFile);
const mockSpawn = vi.mocked(spawn);

describe('show_file tool integration', () => {
  let execute: (args: { path: string; startLine?: number; endLine?: number }) => Promise<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('COPILOT_PREVIEW_BINARY', '/mock/binary');
    const tool = createShowFileTool();
    execute = tool.execute;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Journey 1: code file', () => {
    it('spawns binary with file path and returns message with filename and line count', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false, size: 5000 } as any);
      mockReadFile.mockResolvedValue(Array(245).fill('x').join('\n') as any);

      const result = await execute({ path: '/proj/main.rs' });

      expect(mockSpawn).toHaveBeenCalledWith('/mock/binary', ['/proj/main.rs'], { detached: true, stdio: 'ignore' });
      expect(result).toBe('Opened preview: main.rs (245 lines)');
    });
  });

  describe('Journey 2: line range', () => {
    it('passes start and end line flags to spawn and includes range in message', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false, size: 4000 } as any);
      mockReadFile.mockResolvedValue(Array(200).fill('x').join('\n') as any);

      const result = await execute({ path: '/proj/utils.ts', startLine: 50, endLine: 80 });

      expect(mockSpawn).toHaveBeenCalledWith('/mock/binary', ['/proj/utils.ts', '--start-line', '50', '--end-line', '80'], { detached: true, stdio: 'ignore' });
      expect(result).toBe('Opened preview: utils.ts (200 lines), highlighting lines 50-80');
    });
  });

  describe('Journey 3: consecutive calls', () => {
    it('spawns with correct path for each call and returns correct messages', async () => {
      mockStat
        .mockResolvedValueOnce({ isDirectory: () => false, size: 2000 } as any)
        .mockResolvedValueOnce({ isDirectory: () => false, size: 3000 } as any);
      mockReadFile
        .mockResolvedValueOnce(Array(100).fill('x').join('\n') as any)
        .mockResolvedValueOnce(Array(150).fill('x').join('\n') as any);

      const r1 = await execute({ path: '/proj/a.ts' });
      const r2 = await execute({ path: '/proj/b.ts' });

      expect(r1).toBe('Opened preview: a.ts (100 lines)');
      expect(r2).toBe('Opened preview: b.ts (150 lines)');
      expect(mockSpawn).toHaveBeenCalledWith('/mock/binary', ['/proj/a.ts'], { detached: true, stdio: 'ignore' });
      expect(mockSpawn).toHaveBeenCalledWith('/mock/binary', ['/proj/b.ts'], { detached: true, stdio: 'ignore' });
    });
  });

  describe('Journey 4: markdown file', () => {
    it('returns markdown-specific message without line count', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false, size: 1500 } as any);
      mockReadFile.mockResolvedValue('# Title\n\nBody\n' as any);

      const result = await execute({ path: '/proj/README.md' });

      expect(result).toBe('Opened markdown preview: README.md');
    });
  });

  describe('Journey 5: image file', () => {
    it('returns image-specific message without reading file contents', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false, size: 20000 } as any);

      const result = await execute({ path: '/proj/logo.png' });

      expect(result).toBe('Opened image preview: logo.png');
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  describe('error flows', () => {
    it('throws UserError with file-not-found message and does not spawn when stat throws ENOENT', async () => {
      mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const error = await execute({ path: '/proj/missing.ts' }).catch(e => e);
      expect(error).toBeInstanceOf(UserError);
      expect(error.message).toContain('File not found');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('throws UserError with file-too-large message and does not spawn when size exceeds 10MB', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false, size: 15_000_000 } as any);

      const error = await execute({ path: '/proj/huge.ts' }).catch(e => e);
      expect(error).toBeInstanceOf(UserError);
      expect(error.message).toContain('File too large');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('throws UserError with directory message and does not spawn when path is a directory', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true, size: 0 } as any);

      const error = await execute({ path: '/proj/src' }).catch(e => e);
      expect(error).toBeInstanceOf(UserError);
      expect(error.message).toContain('got a directory');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('throws UserError with binary-not-found message when spawn fails with ENOENT', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false, size: 1000 } as any);
      mockReadFile.mockResolvedValue(Array(50).fill('x').join('\n') as any);
      mockSpawn.mockReturnValue({
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'error') {
            queueMicrotask(() => cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
          }
        }),
        unref: vi.fn(),
      } as any);

      const error = await execute({ path: '/proj/main.ts' }).catch(e => e);
      expect(error).toBeInstanceOf(UserError);
      expect(error.message).toContain('Preview app not found');
    });

    it('throws UserError with unsupported-file-type message and does not spawn for .exe files', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false, size: 100 } as any);

      const error = await execute({ path: '/proj/data.exe' }).catch(e => e);
      expect(error).toBeInstanceOf(UserError);
      expect(error.message).toContain('Unsupported file type');
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });
});
