import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { UserError } from 'fastmcp';
import { validateFile } from './validator.js';
import { launchOrUpdate, resolveAppBinary } from './launcher.js';

export function createShowFileTool() {
  return {
    name: 'show_file',
    description:
      'Show file contents to the user in a preview window. Unlike reading files into context, this opens a visual preview that the user can see directly. Supports code (with syntax highlighting), markdown (rendered), and images.',
    parameters: z.object({
      path: z.string().describe('File path to preview (absolute or relative to project dir)'),
      startLine: z.number().int().positive().optional().describe('Start line to highlight (1-indexed)'),
      endLine: z.number().int().positive().optional().describe('End line to highlight (1-indexed)'),
    }),
    execute: async (args: { path: string; startLine?: number; endLine?: number }): Promise<string> => {
      const result = await validateFile(args.path);

      if (!result.valid) {
        throw new UserError(result.errorMessage);
      }

      if (result.fileType === 'unsupported') {
        throw new UserError('Unsupported file type: ' + path.extname(args.path));
      }

      const binaryPath = resolveAppBinary();
      try {
        await fs.access(binaryPath);
      } catch {
        throw new UserError("Preview app not found. Run 'npm run build:app' in copilot-preview/");
      }

      await launchOrUpdate(result.absolutePath, args.startLine, args.endLine);

      const filename = path.basename(result.absolutePath);

      if (result.fileType === 'markdown') {
        return `Opened markdown preview: ${filename}`;
      }

      if (result.fileType === 'image') {
        return `Opened image preview: ${filename}`;
      }

      let message = `Opened preview: ${filename} (${result.lineCount} lines)`;
      if (args.startLine !== undefined && args.endLine !== undefined) {
        message += `, highlighting lines ${args.startLine}-${args.endLine}`;
      }
      return message;
    },
  };
}
