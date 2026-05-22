import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveAppBinary(): string {
  const envBinary = process.env['COPILOT_PREVIEW_BINARY'];
  if (envBinary) return envBinary;
  return path.resolve(__dirname, '../../src-tauri/target/release/copilot-preview');
}

export async function launchOrUpdate(
  binaryPath: string,
  absolutePath: string,
  startLine?: number,
  endLine?: number,
): Promise<void> {
  const args: string[] = [absolutePath];
  if (startLine !== undefined) {
    args.push('--start-line', `${startLine}`);
  }
  if (endLine !== undefined) {
    args.push('--end-line', `${endLine}`);
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, args, { detached: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
