import path from "node:path";
import { z } from "zod";
import { UserError } from "fastmcp";
import { validateFile } from "./validator.js";
import { launchOrUpdate, resolveAppBinary } from "./launcher.js";

export function createShowFileTool() {
  return {
    name: "show_file",
    description:
      "Open a floating preview panel on the user's screen. Supports code (syntax highlighting), markdown (rendered), and images.",
    parameters: z.object({
      path: z
        .string()
        .describe("File path to preview (absolute or relative to project dir)"),
      startLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Start line to highlight (1-indexed)"),
      endLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("End line to highlight (1-indexed)"),
    }),
    execute: async (args: {
      path: string;
      startLine?: number;
      endLine?: number;
    }): Promise<string> => {
      const result = await validateFile(args.path);

      if (!result.valid) {
        throw new UserError(result.errorMessage);
      }

      const binaryPath = resolveAppBinary();

      try {
        await launchOrUpdate(
          binaryPath,
          result.absolutePath,
          args.startLine,
          args.endLine,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          throw new UserError(
            "Preview app not found. Run 'pnpm build:app' in quick-look/",
          );
        }
        throw new UserError(
          `Failed to launch preview: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const filename = path.basename(result.absolutePath);

      if (result.fileType === "markdown") {
        return `Opened markdown preview: ${filename}`;
      }

      if (result.fileType === "image") {
        return `Opened image preview: ${filename}`;
      }

      const lineSuffix =
        result.lineCount !== undefined ? ` (${result.lineCount} lines)` : "";
      const rangeSuffix =
        args.startLine !== undefined && args.endLine !== undefined
          ? `, highlighting lines ${args.startLine}-${args.endLine}`
          : "";
      return `Opened preview: ${filename}${lineSuffix}${rangeSuffix}`;
    },
  };
}
