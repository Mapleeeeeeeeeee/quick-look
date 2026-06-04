import { vi, describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

import { stat, readFile } from "node:fs/promises";
import { validateFile } from "./validator.js";

const mockStat = vi.mocked(stat);
const mockReadFile = vi.mocked(readFile);

function createMockStat(
  overrides: { isDirectory?: boolean; size?: number } = {},
) {
  return {
    isDirectory: () => overrides.isDirectory ?? false,
    size: overrides.size ?? 100,
  } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("validateFile", () => {
  describe("path resolution", () => {
    it("resolves relative path with CLAUDE_PROJECT_DIR", async () => {
      vi.stubEnv("CLAUDE_PROJECT_DIR", "/project/root");
      mockStat.mockResolvedValue(createMockStat());
      (mockReadFile as any).mockResolvedValue("hello");

      const result = await validateFile("src/main.ts");

      expect(result).toMatchObject({
        valid: true,
        absolutePath: "/project/root/src/main.ts",
      });

      vi.unstubAllEnvs();
    });

    it("resolves relative path with cwd when CLAUDE_PROJECT_DIR not set", async () => {
      vi.stubEnv("CLAUDE_PROJECT_DIR", "");
      mockStat.mockResolvedValue(createMockStat());
      (mockReadFile as any).mockResolvedValue("hello");

      const result = await validateFile("foo.ts");

      expect(result).toMatchObject({
        valid: true,
        absolutePath: resolve(process.cwd(), "foo.ts"),
      });

      vi.unstubAllEnvs();
    });

    it("returns absolute path unchanged when given an absolute path", async () => {
      mockStat.mockResolvedValue(createMockStat());
      (mockReadFile as any).mockResolvedValue("hello");

      const result = await validateFile("/absolute/path/file.ts");

      expect(result).toMatchObject({
        valid: true,
        absolutePath: "/absolute/path/file.ts",
      });
    });
  });

  describe("file existence", () => {
    it("returns File not found error when path does not exist", async () => {
      const enoentError = Object.assign(new Error("ENOENT"), {
        code: "ENOENT",
      });
      mockStat.mockRejectedValue(enoentError);

      const result = await validateFile("/does/not/exist.ts");

      expect(result).toEqual({
        valid: false,
        errorMessage: "File not found: /does/not/exist.ts",
      });
    });

    it("re-throws error when stat fails with non-ENOENT code", async () => {
      const permissionError = Object.assign(new Error("EACCES"), {
        code: "EACCES",
      });
      mockStat.mockRejectedValue(permissionError);

      await expect(validateFile("/restricted/file.ts")).rejects.toThrow(
        "EACCES",
      );
    });
  });

  describe("directory check", () => {
    it("returns directory error when path points to a directory", async () => {
      mockStat.mockResolvedValue(createMockStat({ isDirectory: true }));

      const result = await validateFile("/some/directory");

      expect(result).toEqual({
        valid: false,
        errorMessage: "Expected a file path, got a directory: /some/directory",
      });
    });
  });

  describe("size limit", () => {
    it("returns error for file larger than 10MB with size in message", async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 20_000_000 }));

      const result = await validateFile("/large/file.ts");

      // 20_000_000 / 1_048_576 = 19.073... -> toFixed(1) = "19.1"
      expect(result).toEqual({
        valid: false,
        errorMessage:
          "File too large for preview (19.1MB). Consider using line range.",
      });
    });
  });

  describe("file type detection", () => {
    async function assertFileType(filename: string, expectedType: string) {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      (mockReadFile as any).mockResolvedValue("content");

      const result = await validateFile(`/path/${filename}`);

      expect(result).toMatchObject({ valid: true, fileType: expectedType });
    }

    it.each([
      ["code", "main.rs"],
      ["code", "index.ts"],
      ["code", "script.py"],
      ["markdown", "README.md"],
      ["markdown", "doc.mdx"],
      ["markdown", "config.yaml"],
      ["markdown", "config.yml"],
      ["code", "index.TS"],
      ["code", "Makefile"],
    ])("returns %s type when given %s", async (expectedType, filename) => {
      await assertFileType(filename, expectedType);
    });

    it.each([
      ["image.png", ".png"],
      ["photo.jpg", ".jpg"],
      ["icon.svg", ".svg"],
    ])("returns image type for %s", async (filename) => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      const result = await validateFile(`/path/${filename}`);
      expect(result).toMatchObject({ valid: true, fileType: "image" });
    });

    it.each([
      ["program.exe", ".exe"],
      ["archive.zip", ".zip"],
      ["data.xyz", ".xyz"],
    ])(
      "returns error with unsupported file type message for %s",
      async (filename, ext) => {
        mockStat.mockResolvedValue(createMockStat({ size: 100 }));
        const result = await validateFile(`/path/${filename}`);
        expect(result).toEqual({
          valid: false,
          errorMessage: `Unsupported file type: ${ext}`,
        });
      },
    );
  });

  describe("line count", () => {
    it("returns line count when code file size is within 1MB", async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));
      (mockReadFile as any).mockResolvedValue("line1\nline2\nline3");

      const result = await validateFile("/path/file.ts");

      expect(result).toMatchObject({ valid: true, lineCount: 3 });
    });

    it("returns line count when code file size is exactly at 1MB boundary", async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 1_048_576 }));
      (mockReadFile as any).mockResolvedValue("line1\nline2");
      const result = await validateFile("/path/file.ts");
      expect(result).toMatchObject({ valid: true, lineCount: 2 });
    });

    it("returns undefined line count and skips readFile when code file exceeds 1MB", async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 1_048_577 }));

      const result = await validateFile("/path/file.ts");

      expect(result).toMatchObject({ valid: true, lineCount: undefined });
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it("returns line count when file is markdown", async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 500 }));
      (mockReadFile as any).mockResolvedValue("# Title\n\nBody text.");

      const result = await validateFile("/path/README.md");

      expect(result).toMatchObject({ valid: true, lineCount: 3 });
    });

    it("returns undefined line count and skips readFile when file is an image", async () => {
      mockStat.mockResolvedValue(createMockStat({ size: 100 }));

      const result = await validateFile("/path/image.png");

      expect(result).toMatchObject({ valid: true, lineCount: undefined });
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });
});
