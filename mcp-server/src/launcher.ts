import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveAppBinary(): string {
  const envBinary = process.env['COPILOT_PREVIEW_BINARY'];
  if (envBinary) return envBinary;
  return path.resolve(__dirname, '../../src-tauri/target/release/copilot-preview');
}

export async function launchOrUpdate(absolutePath: string, startLine?: number, endLine?: number): Promise<void> {
  const binaryPath = resolveAppBinary();

  const args: string[] = [absolutePath];
  if (startLine !== undefined) {
    args.push('--start-line', `${startLine}`);
  }
  if (endLine !== undefined) {
    args.push('--end-line', `${endLine}`);
  }

  const child = spawn(binaryPath, args, { detached: true, stdio: 'ignore' });
  child.unref();
}
