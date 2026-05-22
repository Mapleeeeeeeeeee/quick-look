import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// MCP test client — communicates with the real server via newline-delimited JSON
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: unknown;
}

interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

class McpTestClient {
  private process: ChildProcess;
  private buffer = '';
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>();

  constructor() {
    const serverPath = path.resolve(__dirname, '../dist/index.js');
    this.process = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        COPILOT_PREVIEW_BINARY: '/tmp/fake-copilot-preview',
        CLAUDE_PROJECT_DIR: '/tmp/mcp-e2e-test',
      },
    });

    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.flushBuffer();
    });
  }

  private flushBuffer(): void {
    const lines = this.buffer.split('\n');
    // The last element may be a partial line — keep it in the buffer
    this.buffer = lines.pop()!;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(trimmed) as JsonRpcResponse;
      } catch {
        // Non-JSON output (e.g. debug logs) — ignore
        continue;
      }
      if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
        const { resolve } = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);
        resolve(msg);
      }
    }
  }

  send(method: string, params: unknown = {}): Promise<JsonRpcResponse> {
    const id = ++this.messageId;
    const msg = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin!.write(JSON.stringify(msg) + '\n');
    });
  }

  initialize(): Promise<JsonRpcResponse> {
    return this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '0.1.0' },
    });
  }

  listTools(): Promise<JsonRpcResponse> {
    return this.send('tools/list', {});
  }

  callTool(name: string, args: Record<string, unknown>): Promise<JsonRpcResponse> {
    return this.send('tools/call', { name, arguments: args });
  }

  close(): Promise<void> {
    this.process.stdin!.end();
    return new Promise((resolve) => {
      this.process.on('close', () => resolve());
      setTimeout(() => {
        this.process.kill();
        resolve();
      }, 3000);
    });
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_DIR = '/tmp/mcp-e2e-test';
const FAKE_BINARY = '/tmp/fake-copilot-preview';

beforeAll(() => {
  // Build the server so dist/index.js is up to date
  execSync('npx tsc', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  });

  mkdirSync(TEST_DIR, { recursive: true });

  writeFileSync(
    path.join(TEST_DIR, 'test.ts'),
    'const x = 1;\nconst y = 2;\nconst z = 3;\n',
  );
  writeFileSync(
    path.join(TEST_DIR, 'README.md'),
    '# Test\n\nHello world\n',
  );
  // PNG magic bytes — validator only checks extension, not magic bytes
  writeFileSync(
    path.join(TEST_DIR, 'logo.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  writeFileSync(path.join(TEST_DIR, 'data.exe'), 'binary');

  // Fake Tauri binary — just exits successfully
  writeFileSync(FAKE_BINARY, '#!/bin/sh\nexit 0\n');
  chmodSync(FAKE_BINARY, 0o755);
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(FAKE_BINARY, { force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP server E2E', () => {
  let client: McpTestClient;

  beforeEach(async () => {
    client = new McpTestClient();
    await client.initialize();
  }, 10000);

  afterEach(async () => {
    await client.close();
  }, 10000);

  it('responds to initialize with server info', async () => {
    // A fresh client so we can inspect the initialize response directly
    const freshClient = new McpTestClient();
    const response = await freshClient.initialize();
    await freshClient.close();

    const result = response.result as { serverInfo: { name: string; version: string } };
    expect(result.serverInfo.name).toBe('copilot-preview');
    expect(result.serverInfo.version).toBeDefined();
  }, 10000);

  it('lists show_file tool with correct schema', async () => {
    const response = await client.listTools();

    const result = response.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> };
    expect(result.tools).toBeDefined();

    const showFileTool = result.tools.find((t) => t.name === 'show_file');
    expect(showFileTool).toBeDefined();

    const properties = showFileTool!.inputSchema.properties;
    expect(properties['path']).toBeDefined();
    expect(properties['startLine']).toBeDefined();
    expect(properties['endLine']).toBeDefined();
  }, 10000);

  it('returns success message for valid code file', async () => {
    const response = await client.callTool('show_file', { path: 'test.ts' });

    const result = response.result as McpToolResult;
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('test.ts');
    expect(result.content[0].text).toContain('4 lines');
  }, 10000);

  it('returns markdown message for .md file', async () => {
    const response = await client.callTool('show_file', { path: 'README.md' });

    const result = response.result as McpToolResult;
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('markdown preview');
  }, 10000);

  it('returns image message for .png file', async () => {
    const response = await client.callTool('show_file', { path: 'logo.png' });

    const result = response.result as McpToolResult;
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('image preview');
  }, 10000);

  it('returns error for non-existent file', async () => {
    const response = await client.callTool('show_file', { path: 'nonexistent.ts' });

    const result = response.result as McpToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('File not found');
  }, 10000);

  it('returns error for unsupported file type', async () => {
    const response = await client.callTool('show_file', { path: 'data.exe' });

    const result = response.result as McpToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unsupported file type');
  }, 10000);

  it('includes line range in message when startLine and endLine provided', async () => {
    const response = await client.callTool('show_file', {
      path: 'test.ts',
      startLine: 1,
      endLine: 2,
    });

    const result = response.result as McpToolResult;
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('highlighting lines 1-2');
  }, 10000);
});
