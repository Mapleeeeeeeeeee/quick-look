import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { FileType, ValidationResult } from "./types.js";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".bmp",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".css",
  ".html",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".scala",
  ".r",
  ".lua",
  ".vim",
  ".dockerfile",
  ".makefile",
  ".cmake",
  ".tf",
  ".hcl",
  ".graphql",
  ".proto",
  ".prisma",
  ".vue",
  ".svelte",
  ".jsx",
  ".tsx",
  ".mjs",
  ".cjs",
  ".txt",
  ".log",
  ".env",
  ".gitignore",
  ".editorconfig",
]);

const UNSUPPORTED_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

const ONE_MB = 1_048_576;
const TEN_MB = 10_485_760;

function detectFileType(filePath: string): FileType {
  const ext = extname(filePath).toLowerCase();

  if (ext === "") {
    return "code";
  }

  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (UNSUPPORTED_EXTENSIONS.has(ext)) return "unsupported";
  if (CODE_EXTENSIONS.has(ext)) return "code";

  return "unsupported";
}

export async function validateFile(
  inputPath: string,
): Promise<ValidationResult> {
  const absolutePath = inputPath.startsWith("/")
    ? inputPath
    : resolve(process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd(), inputPath);

  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(absolutePath);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { valid: false, errorMessage: `File not found: ${absolutePath}` };
    }
    throw error;
  }

  if (fileStat.isDirectory()) {
    return {
      valid: false,
      errorMessage: `Expected a file path, got a directory: ${absolutePath}`,
    };
  }

  const sizeBytes = fileStat.size;
  if (sizeBytes > TEN_MB) {
    const sizeMB = (sizeBytes / ONE_MB).toFixed(1);
    return {
      valid: false,
      errorMessage: `File too large for preview (${sizeMB}MB). Consider using line range.`,
    };
  }

  const fileType = detectFileType(absolutePath);

  let lineCount: number | undefined;
  if ((fileType === "code" || fileType === "markdown") && sizeBytes <= ONE_MB) {
    const content = await readFile(absolutePath, "utf-8");
    lineCount = content.split("\n").length;
  }

  return { valid: true, absolutePath, fileType, lineCount, sizeBytes };
}
