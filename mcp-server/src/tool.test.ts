import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./validator.js', () => ({
  validateFile: vi.fn(),
}));

vi.mock('./launcher.js', () => ({
  resolveAppBinary: vi.fn(),
  launchOrUpdate: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: { access: vi.fn() },
  access: vi.fn(),
}));

import { validateFile } from './validator.js';
import { resolveAppBinary, launchOrUpdate } from './launcher.js';
import fs from 'node:fs/promises';
import { createShowFileTool } from './tool.js';
import { UserError } from 'fastmcp';

const mockValidate = vi.mocked(validateFile);
const mockResolve = vi.mocked(resolveAppBinary);
const mockLaunch = vi.mocked(launchOrUpdate);
const mockFsAccess = vi.mocked(fs.access);

describe('show_file tool integration', () => {
  let execute: (args: { path: string; startLine?: number; endLine?: number }) => Promise<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    const tool = createShowFileTool();
    execute = tool.execute;
    mockResolve.mockReturnValue('/path/to/binary');
    mockFsAccess.mockResolvedValue(undefined);
  });

  describe('Journey 1: code file', () => {
    it('spawns binary and returns success message with filename and line count', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        absolutePath: '/proj/main.rs',
        fileType: 'code',
        lineCount: 245,
        sizeBytes: 5000,
      });
      mockLaunch.mockResolvedValue(undefined);

      const result = await execute({ path: 'main.rs' });

      expect(mockLaunch).toHaveBeenCalledWith('/proj/main.rs', undefined, undefined);
      expect(result).toContain('main.rs');
      expect(result).toContain('245 lines');
    });
  });

  describe('Journey 2: line range', () => {
    it('passes startLine and endLine to launcher and includes in message', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        absolutePath: '/proj/utils.ts',
        fileType: 'code',
        lineCount: 200,
        sizeBytes: 4000,
      });
      mockLaunch.mockResolvedValue(undefined);

      const result = await execute({ path: 'utils.ts', startLine: 50, endLine: 80 });

      expect(mockLaunch).toHaveBeenCalledWith('/proj/utils.ts', 50, 80);
      expect(result).toContain('highlighting lines 50-80');
    });
  });

  describe('Journey 3: consecutive calls', () => {
    it('calls launcher twice with different paths', async () => {
      mockValidate
        .mockResolvedValueOnce({
          valid: true,
          absolutePath: '/proj/a.ts',
          fileType: 'code',
          lineCount: 100,
          sizeBytes: 2000,
        })
        .mockResolvedValueOnce({
          valid: true,
          absolutePath: '/proj/b.ts',
          fileType: 'code',
          lineCount: 150,
          sizeBytes: 3000,
        });
      mockLaunch.mockResolvedValue(undefined);

      await execute({ path: 'a.ts' });
      await execute({ path: 'b.ts' });

      expect(mockLaunch).toHaveBeenCalledTimes(2);
      expect(mockLaunch).toHaveBeenNthCalledWith(1, '/proj/a.ts', undefined, undefined);
      expect(mockLaunch).toHaveBeenNthCalledWith(2, '/proj/b.ts', undefined, undefined);
    });
  });

  describe('Journey 4: markdown file', () => {
    it('returns markdown-specific message', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        absolutePath: '/proj/README.md',
        fileType: 'markdown',
        lineCount: 80,
        sizeBytes: 1500,
      });
      mockLaunch.mockResolvedValue(undefined);

      const result = await execute({ path: 'README.md' });

      expect(result).toContain('markdown preview');
    });
  });

  describe('Journey 5: image file', () => {
    it('returns image-specific message', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        absolutePath: '/proj/logo.png',
        fileType: 'image',
        lineCount: undefined,
        sizeBytes: 20000,
      });
      mockLaunch.mockResolvedValue(undefined);

      const result = await execute({ path: 'logo.png' });

      expect(result).toContain('image preview');
    });
  });

  describe('error flows', () => {
    it('throws UserError when file not found', async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        errorMessage: 'File not found: /proj/missing.ts',
      });

      await expect(execute({ path: 'missing.ts' })).rejects.toBeInstanceOf(UserError);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it('throws UserError when file too large', async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        errorMessage: 'File too large for preview (15.0MB). Consider using line range.',
      });

      await expect(execute({ path: 'huge.ts' })).rejects.toBeInstanceOf(UserError);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it('throws UserError when path is directory', async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        errorMessage: 'Expected a file path, got a directory: /proj/src',
      });

      await expect(execute({ path: 'src' })).rejects.toBeInstanceOf(UserError);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it('throws UserError when binary not found', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        absolutePath: '/proj/main.ts',
        fileType: 'code',
        lineCount: 50,
        sizeBytes: 1000,
      });
      mockFsAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await expect(execute({ path: 'main.ts' })).rejects.toBeInstanceOf(UserError);
      await expect(execute({ path: 'main.ts' })).rejects.toThrow('Preview app not found');
      expect(mockLaunch).not.toHaveBeenCalled();
    });
  });
});
