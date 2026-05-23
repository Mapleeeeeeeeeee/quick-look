import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { writeFileSync, mkdirSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINARY_PATH = path.resolve(
  __dirname,
  "../src-tauri/target/release/copilot-preview",
);
const BINARY_EXISTS = existsSync(BINARY_PATH);
const SMOKE_ENABLED = BINARY_EXISTS && process.env["SMOKE_TEST"] === "1";

describe.skipIf(!SMOKE_ENABLED)("app smoke tests", () => {
  const TEST_DIR = "/tmp/smoke-test-preview";
  let appProcess: ChildProcess | null = null;

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(`${TEST_DIR}/test.ts`, "const x = 1;\n");
    writeFileSync(`${TEST_DIR}/other.ts`, "const y = 2;\n");
  });

  afterEach(async () => {
    if (appProcess && !appProcess.killed) {
      appProcess.kill();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    appProcess = null;
    try {
      execSync("pkill -f copilot-preview 2>/dev/null");
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(() => {
    try {
      execSync(`rm -rf ${TEST_DIR}`);
    } catch {}
  });

  it("launches successfully with a file path argument", async () => {
    appProcess = spawn(BINARY_PATH, [`${TEST_DIR}/test.ts`], {
      detached: true,
      stdio: "ignore",
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(appProcess.killed).toBe(false);
    expect(appProcess.exitCode).toBeNull();
  }, 10000);

  it("launches without arguments and does not crash", async () => {
    appProcess = spawn(BINARY_PATH, [], {
      detached: true,
      stdio: "ignore",
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(appProcess.killed).toBe(false);
    expect(appProcess.exitCode).toBeNull();
  }, 10000);

  it("exits cleanly when killed with SIGTERM", async () => {
    appProcess = spawn(BINARY_PATH, [`${TEST_DIR}/test.ts`], {
      detached: true,
      stdio: "ignore",
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(appProcess.exitCode).toBeNull();

    appProcess.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      appProcess!.on("close", () => resolve());
      setTimeout(() => resolve(), 3000);
    });

    expect(appProcess.killed).toBe(true);
  }, 10000);

  it("enforces single instance - second launch does not create new process", async () => {
    appProcess = spawn(BINARY_PATH, [`${TEST_DIR}/test.ts`], {
      detached: true,
      stdio: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const countBefore = countProcesses();

    const secondProcess = spawn(BINARY_PATH, [`${TEST_DIR}/other.ts`], {
      detached: true,
      stdio: "ignore",
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const countAfter = countProcesses();
    expect(countAfter).toBe(countBefore);

    if (!secondProcess.killed) secondProcess.kill();
  }, 15000);
});

function countProcesses(): number {
  try {
    const output = execSync("pgrep -f copilot-preview", { encoding: "utf-8" });
    return output.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}
