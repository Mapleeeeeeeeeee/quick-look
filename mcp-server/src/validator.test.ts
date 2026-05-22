import { vi, describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

import { stat, readFile } from 'node:fs/promises';
import { validateFile } from './validator.js';

const mockStat = vi.mocked(stat);
const mockReadFile = vi.mocked(readFile);

function createMockStat(overrides: { isDirectory?: boolean; size?: number } = {}) {
  return {
    isDirectory: () => overrides.isDirectory ?? false,
    size: overrides.size ?? 100,
  } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('validateFile', () => {
  describe('path resolution', () => {
    it('resolves relative path with CLAUDE_PROJECT_DIR', async () => {
      vi.stubEnv('CLAUDE_PROJECT_DIR', '/project/root');
      mockStat.mockResolvedValue(createMockStat());
      (mockReadFile as any).mockResolvedValue('hello');

      const result = await validateFile('src/main.ts');

      expect(result).toMatchObject({
        valid: true,
        absolutePath: '/project/root/src/main.ts',
      });

      vi.unstubAllEnvs();
    });

    it('resolves relative path with cwd when CLAUDE_PROJECT_DIR not set', async () => {
      vi.stubEnv('CLAUDE_PROJECT_DIR', '');
      mockStat.mockResolvedValue(createMockStat());
      (mockReadFile as any).mockResolvedValue('hello');

      const result = await validateFile('foo.ts');

      expect(result).toMatchObject({
        valid: true,
        absolutePath: resolve(process.cwd(), 'foo.ts'),
      });

      vi.unstubAllEnvs();
    });

    it('uses absolute path as-is', async () => {
      mockStat.mockResolvedValue(createMockStat());
      (mockReadFile as any).mockResolvedValue('hello');

      const result = await validateFile('/absolute/path/file.ts');

      expect(result).toMatchObject({
        valid: true,
        absolutePath: '/absolute/path/file.ts',
      });
    });
  });

  describe('file existence', () => {
    it('returns error for non-existent file', async () => {
      const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockStat.mockRejectedValue(enoentError);

      const result = await validateFile('/does/not/exist.ts');

      expect(result).toEqual({
        valid: false,
        errorMessage: 'File not found: /does/not/exist.ts',
      });
    });

    it('re-throws non-ENOENT errors', async () => {
      const permissionError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      mockStat.mockRejectedValue(permissionError);

      await expect(validateFile('/restricted/file.ts')).rejects.toThrow('EACCES');
    });
  });

  describe('directory check', () => {
    it('returns error for directory path', async () => {
      mockStat.mockResolvedValue(createMockStat({ isDirectory: true }));

      const result = await validateFile('/some/directory');

      expect(result).toEqual({
        valid: false,
        errorMessage: 'Expected a file path, got a directory: /some/directory',
      });
    });
  });

  describe('size limit', () => {
    it('returns error for file larger than 10MB with size in message', async () => {
      const sizeBytes = 20_000_000;
      mockStat.mockResolvedValue(createMockStat({ size: sizeBytes }));

      const result = await validateFile('/large/file.ts');

      const expectedMB = (sizeBytes / 1_048_576).toFixed(1);
      expect(result).toEqual({
        valid: false,
        errorMessage: `File too large for preview (${expectedMB}MB). Consider using line range.`,
      });
    });
  });

  describe('file type detection', () => {
    async function assertFileType(filename: string, expectedType: string) {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      (mockReadFile as any).mockResolvedValue('content');

      const result = await validateFile(`/path/${filename}`);

      expect(result).toMatchObject({ valid: true, fileType: expectedType });
    }

    it('detects .rs as code', async () => {
      await assertFileType('main.rs', 'code');
    });

    it('detects .ts as code', async () => {
      await assertFileType('index.ts', 'code');
    });

    it('detects .py as code', async () => {
      await assertFileType('script.py', 'code');
    });

    it('detects .md as markdown', async () => {
      await assertFileType('README.md', 'markdown');
    });

    it('detects .png as image', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      const result = await validateFile('/path/image.png');
      expect(result).toMatchObject({ valid: true, fileType: 'image' });
    });

    it('detects .jpg as image', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      const result = await validateFile('/path/photo.jpg');
      expect(result).toMatchObject({ valid: true, fileType: 'image' });
    });

    it('detects .svg as image', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      const result = await validateFile('/path/icon.svg');
      expect(result).toMatchObject({ valid: true, fileType: 'image' });
    });

    it('detects .exe as unsupported', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      const result = await validateFile('/path/program.exe');
      expect(result).toMatchObject({ valid: true, fileType: 'unsupported' });
    });

    it('detects .zip as unsupported', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      const result = await validateFile('/path/archive.zip');
      expect(result).toMatchObject({ valid: true, fileType: 'unsupported' });
    });

    it('detects extensionless file as code', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      (mockReadFile as any).mockResolvedValue('content');
      const result = await validateFile('/path/Makefile');
      expect(result).toMatchObject({ valid: true, fileType: 'code' });
    });
  });

  describe('line count', () => {
    it('counts lines for code file ≤1MB', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      (mockReadFile as any).mockResolvedValue('line1\nline2\nline3');

      const result = await validateFile('/path/file.ts');

      expect(result).toMatchObject({ valid: true, lineCount: 3 });
    });

    it('skips line count for code file >1MB', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 1_048_577 }));

      const result = await validateFile('/path/file.ts');

      expect(result).toMatchObject({ valid: true, lineCount: undefined });
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('counts lines for markdown file', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 500 }));
      (mockReadFile as any).mockResolvedValue('# Title\n\nBody text.');

      const result = await validateFile('/path/README.md');

      expect(result).toMatchObject({ valid: true, lineCount: 3 });
    });

    it('does not count lines for image file', async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));

      const result = await validateFile('/path/image.png');

      expect(result).toMatchObject({ valid: true, lineCount: undefined });
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });
});
