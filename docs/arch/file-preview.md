# Architecture: File Preview

## 概述

MCP server（FastMCP / TypeScript）接受 `show_file` tool call，在回傳 Claude 之前先驗證檔案（存在、大小、類型），然後 spawn Tauri app binary 並把參數透過 CLI args 傳入。Tauri 使用 `tauri-plugin-single-instance`，若 app 已在跑則攔截 argv 並透過 Rust event 通知 frontend 替換內容，不開新視窗。Frontend 是 Vite + vanilla TypeScript，依副檔名決定渲染策略：Monaco Editor（code）、marked.js（markdown）、`<img>`（image）。視窗 frameless、ESC 關閉、dark theme，完全唯讀。

關鍵決策：IPC 機制選 single-instance plugin 而非 unix socket 或 HTTP localhost，因為它不需要額外 daemon、不需要 port 管理，Tauri 官方支援，複雜度最低。Markdown 切換：在同一個 HTML shell 內維護兩個 container（`#monaco-container`、`#content-container`），renderer dispatch 時顯示一個、隱藏另一個，避免 Monaco dispose/recreate 開銷。

## Files to Create

| File | Purpose |
|------|---------|
| `package.json` | Monorepo root，定義 `build:mcp`、`build:app`、`dev` scripts |
| `mcp-server/package.json` | MCP server npm 套件設定，dependencies: fastmcp, zod |
| `mcp-server/tsconfig.json` | TypeScript 設定，target ESNext，module NodeNext |
| `mcp-server/src/index.ts` | Entry point：建立 FastMCP server，掛載 show_file tool，stdio transport |
| `mcp-server/src/tool.ts` | show_file tool handler：validate → resolve path → launch → return message |
| `mcp-server/src/validator.ts` | 檔案驗證：存在、非目錄、大小上限、副檔名 → FileType 分類 |
| `mcp-server/src/launcher.ts` | spawn Tauri binary（detached + unref），resolveAppBinary() |
| `mcp-server/src/types.ts` | ShowFileParams、FileType、ValidationResult type definitions |
| `src-tauri/Cargo.toml` | Rust deps：tauri v2、tauri-plugin-single-instance、tauri-plugin-cli、tauri-plugin-fs |
| `src-tauri/tauri.conf.json` | Window：decorations false、900x650；plugins.cli.args 宣告 |
| `src-tauri/capabilities/default.json` | 宣告 window、event emit/listen、fs read-text-file 等 API 權限 |
| `src-tauri/src/main.rs` | plugin init、single-instance callback（relay argv as event）、CLI args → emit file-ready |
| `src/index.html` | HTML shell：drag-region header、`#monaco-container`、`#content-container` |
| `src/main.ts` | Frontend entry：listen("file-ready") + listen("new-file-request") → handleFileRequest() |
| `src/renderer.ts` | FileType dispatch：mount/unmount 對應 renderer，管理 container 顯示切換 |
| `src/renderers/code-renderer.ts` | Monaco init、detectLanguage、deltaDecorations highlight、revealLineInCenter |
| `src/renderers/markdown-renderer.ts` | marked.parse + DOMPurify.sanitize、raw/rendered toggle |
| `src/renderers/image-renderer.ts` | convertFileSrc → img src、object-fit contain、wheel zoom |
| `src/keyboard.ts` | 全域 ESC → getCurrentWindow().close() |
| `src/styles/main.css` | Dark theme base、drag-region header、container layout |
| `src/styles/markdown.css` | GitHub-style prose：h1-h6、ul/ol、code block、blockquote |
| `vite.config.ts` | Monaco worker 設定（vite-plugin-monaco-editor） |

## Responsibility Map

| 元件 | 層級 | 負責 | 不碰 |
|------|------|------|------|
| `mcp-server/src/tool.ts` | MCP | 接收 tool call、組裝參數、呼叫 validator + launcher、回傳文字 | 檔案讀取內容、UI 邏輯 |
| `mcp-server/src/validator.ts` | MCP | 存在/目錄/大小/類型檢查，回傳 ValidationResult | spawn 邏輯、路徑解析以外的事 |
| `mcp-server/src/launcher.ts` | MCP | resolveAppBinary、spawn（detached + unref） | 驗證、錯誤訊息格式 |
| `src-tauri/src/main.rs` | Tauri backend | plugin init、single-instance argv relay、CLI args 讀取、emit events | Frontend 渲染邏輯 |
| `src/main.ts` | Frontend entry | event 監聽、handleFileRequest 分派 | 具體 renderer 邏輯 |
| `src/renderer.ts` | Frontend | FileType → renderer 對應、container show/hide、unmount 清理 | 個別 renderer 內部 |
| `src/renderers/code-renderer.ts` | Frontend | Monaco lifecycle、language id 對照、highlight decoration、scroll | markdown / image 渲染 |
| `src/renderers/markdown-renderer.ts` | Frontend | marked + DOMPurify、sanitized HTML 寫入、toggle state | code / image 渲染 |
| `src/renderers/image-renderer.ts` | Frontend | img src（asset protocol）、fit/zoom CSS | code / markdown 渲染 |
| `src/keyboard.ts` | Frontend | ESC 綁定、視窗關閉 | 任何渲染邏輯 |

## Interface Design

### MCP Server Types

```typescript
// mcp-server/src/types.ts

type FileType = 'code' | 'markdown' | 'image' | 'unsupported';

interface ShowFileParams {
  path: string;
  startLine?: number;
  endLine?: number;
}

type ValidationResult =
  | { valid: true; absolutePath: string; fileType: FileType; lineCount: number | undefined; sizeBytes: number }
  | { valid: false; errorMessage: string };
```

### MCP Tool Schema

```typescript
// mcp-server/src/tool.ts
const showFileSchema = z.object({
  path: z.string().describe('File path (absolute or relative to project dir)'),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});
```

### Launcher

```typescript
// mcp-server/src/launcher.ts
function resolveAppBinary(): string;
// returns <project-root>/src-tauri/target/release/copilot-preview

async function launchOrUpdate(
  absolutePath: string,
  startLine: number | undefined,
  endLine: number | undefined,
): Promise<void>;
// spawn(binary, [absolutePath, ...flags], { detached: true, stdio: 'ignore' })
// child.unref()
```

### Tauri CLI Args Contract

```
copilot-preview <file-path> [--start-line <n>] [--end-line <n>]
```

定義在 `tauri.conf.json` 的 `plugins.cli.args`。`main.rs` 用 `app.get_cli_matches()` 讀取，構造 FileRequest 後 `app_handle.emit("file-ready", payload)`。

### Single-Instance Event Payload

```typescript
// Event name emitted from Rust: "new-file-request"
// Event name for initial load: "file-ready"
interface FileRequest {
  path: string;       // absolute path
  startLine?: number;
  endLine?: number;
}
```

`main.rs` single-instance callback 把 `argv[1..]` 解析成 `FileRequest`，透過 `app_handle.emit("new-file-request", payload)` 發給 frontend。

### Renderer Interface

```typescript
// src/renderer.ts
interface Renderer {
  mount(container: HTMLElement, req: FileRequest): Promise<void>;
  unmount(): void;
}
```

`code-renderer.ts`、`markdown-renderer.ts`、`image-renderer.ts` 各自 export 一個實作此 interface 的物件。

## Data Flow

### Journey 1 & 2：首次開啟程式碼檔案（含行範圍）

```
使用者說「讓我看 src/main.rs 第 50-80 行」
  │
Claude 呼叫 show_file({ path: "src/main.rs", startLine: 50, endLine: 80 })
  │
[tool.ts] resolve path: CLAUDE_PROJECT_DIR + "src/main.rs" → /abs/path/main.rs
  │
[validator.ts] stat → exists ✓ → not dir ✓ → size < 10MB ✓ → ext .rs → FileType: "code"
  │
[launcher.ts] spawn("/binary /abs/path/main.rs --start-line 50 --end-line 80",
               { detached: true, stdio: 'ignore' }) → child.unref()
  │
[tool.ts] return "已開啟 src/main.rs 預覽 (245 lines，highlight 第 50-80 行)"
  ← Claude 收到，對話繼續
  │
[main.rs — new process] single-instance: 無既有 instance
  get_cli_matches() → path, start-line=50, end-line=80
  emit("file-ready", { path, startLine: 50, endLine: 80 })
  │
[src/main.ts] listen("file-ready") → handleFileRequest({ path, startLine: 50, endLine: 80 })
  │
[renderer.ts] detectFileType(".rs") → "code"
  currentRenderer?.unmount()
  show #monaco-container, hide #content-container
  mount code-renderer
  │
[code-renderer.ts]
  monaco.editor.create(#monaco-container, { readOnly: true, theme: "vs-dark" })
  language = detectLanguage(".rs") → "rust"
  content = await readTextFile(path)   // tauri-plugin-fs
  editor.setValue(content)
  editor.deltaDecorations([], [{ range: {50..80}, options: { className: "line-highlight" } }])
  editor.revealLineInCenter(50)
```

### Journey 3：連續預覽（視窗已開啟）

```
Claude 呼叫 show_file({ path: "b.ts" })
  │
[launcher.ts] spawn("binary b.ts", ...)
  │
[main.rs — second process] single-instance: 既有 instance 偵測到
  callback(argv: ["b.ts"]) → parse → FileRequest { path: "/abs/b.ts" }
  app_handle.emit("new-file-request", payload)  ← 送給既有 instance
  新 process 自動退出
  │
[既有 instance src/main.ts] listen("new-file-request")
  handleFileRequest({ path: "/abs/b.ts" })
  │
[renderer.ts] currentRenderer.unmount()  ← Monaco dispose
  mount code-renderer for b.ts
```

### Journey 4：Markdown

```
show_file({ path: "README.md" })
  → validator: ".md" → FileType: "markdown"
  → launcher: spawn binary README.md
  → main.rs emit("file-ready", { path })
  → renderer.ts: hide #monaco-container, show #content-container
    mount markdown-renderer
  → markdown-renderer.ts:
      content = await readTextFile(path)
      html = marked.parse(content)
      container content = DOMPurify.sanitize(html)
      renderToggle.show()
```

### Journey 5：圖片

```
show_file({ path: "screenshot.png" })
  → validator: ".png" → FileType: "image"
  → renderer.ts: hide #monaco-container, show #content-container
    mount image-renderer
  → image-renderer.ts:
      img.src = convertFileSrc(absolutePath)   // asset:// protocol
      img.style.objectFit = "contain"
```

### 錯誤流程

```
show_file({ path: "nonexistent.txt" })
  → validator: fs.stat → ENOENT
  → tool.ts: throw new UserError("File not found: nonexistent.txt")
  → Claude 收到錯誤，不 spawn，不開視窗

show_file({ path: "huge-log.txt" })  // 15MB
  → validator: sizeBytes > 10_485_760
  → throw new UserError("File too large for preview (15MB). Consider using line range.")

show_file({ path: "/some/dir" })
  → validator: stat.isDirectory() === true
  → throw new UserError("Expected a file path, got a directory: /some/dir")
```

## Build Sequence

### Phase 1：MCP Server 可用（不需要 Tauri app）
_Additive_

- [ ] 建立 `mcp-server/`，`npm init`，安裝 fastmcp、zod、typescript
- [ ] 實作 `types.ts`
- [ ] 實作 `validator.ts`（全部驗證邏輯 + 副檔名 → FileType 對照）
- [ ] 實作 `tool.ts`（launcher 先 stub：`console.error("would spawn:", path)`）
- [ ] 實作 `index.ts`（FastMCP server init + stdio start）
- [ ] 手動 JSON-RPC 測試
- [ ] `claude mcp add` 註冊，Claude 呼叫 tool 確認回傳訊息

**Phase 1 結束條件**：Claude 說「讓我看 main.rs」→ Claude 收到預覽訊息（視窗尚不出現）。

### Phase 2：Tauri 空視窗
_Additive_

- [ ] `cargo create-tauri-app`，選 Vite + TypeScript
- [ ] `tauri.conf.json`：`decorations: false`、`width: 900`、`height: 650`
- [ ] `capabilities/default.json`：window、event 基本權限
- [ ] `src/index.html`：`data-tauri-drag-region` header、`#monaco-container`、`#content-container`
- [ ] `src/styles/main.css`：dark theme base、drag-region
- [ ] `src/keyboard.ts`：ESC → `getCurrentWindow().close()`
- [ ] `cargo tauri build` → 確認 binary 存在、dark frameless 視窗、ESC 關閉

**Phase 2 結束條件**：binary 執行後出現空 dark window，ESC 關閉。

### Phase 3：CLI Args + Single-Instance IPC 串通
_Additive_

- [ ] `Cargo.toml` 加 `tauri-plugin-cli`、`tauri-plugin-single-instance`
- [ ] `tauri.conf.json plugins.cli`：positional `path`、optional `--start-line`、`--end-line`
- [ ] `capabilities/default.json`：補 `cli:default`、`event:default`
- [ ] `main.rs`：plugin init + single-instance callback + CLI args → emit events
- [ ] `src/main.ts`：listen events → console.log 確認收到
- [ ] `launcher.ts`：實作 resolveAppBinary + launchOrUpdate

**Phase 3 結束條件**：MCP tool 呼叫後視窗彈出，console 印出 FileRequest；連續兩次呼叫，原視窗收到 new-file-request。

### Phase 4：Code Renderer（Journey 1 & 2）
_Additive_

- [ ] `npm install monaco-editor vite-plugin-monaco-editor`
- [ ] `vite.config.ts`：Monaco worker plugin
- [ ] `src/renderers/code-renderer.ts`：detectLanguage、Monaco create、highlight、scroll
- [ ] `src/renderer.ts`：code branch
- [ ] `src/main.ts`：handleFileRequest → renderer dispatch
- [ ] `capabilities/default.json`：`fs:allow-read-text-file`

**Phase 4 結束條件**：Journey 1（syntax highlight + 行號）、Journey 2（line range highlight + scroll）AC 全綠。

### Phase 5：Markdown & Image Renderer（Journey 4 & 5）
_Additive_

- [ ] `npm install marked dompurify @types/dompurify`
- [ ] `src/renderers/markdown-renderer.ts`：marked + DOMPurify + toggle
- [ ] `src/styles/markdown.css`：GitHub-style prose
- [ ] `src/renderers/image-renderer.ts`：convertFileSrc + object-fit + zoom
- [ ] `src/renderer.ts`：補 markdown + image branch

**Phase 5 結束條件**：Journey 3（連續替換）、Journey 4（markdown render）、Journey 5（圖片 fit）均可走通。

### Phase 6：錯誤處理 + 端對端驗收
_Additive_

- [ ] `launcher.ts`：binary 不存在 → UserError
- [ ] `validator.ts`：確認所有錯誤訊息格式符合設計文件
- [ ] 整合測試跑通
- [ ] Claude Code 中走完 Journey 1-5 + 所有錯誤 AC

## Infra Reuse

| Library | 版本 | 使用方式 |
|---------|------|---------|
| `fastmcp` | latest | `new FastMCP()` → `addTool()` → `start({ transportType: "stdio" })` |
| `zod` | ^3 | tool parameter schema |
| `tauri` | v2 | frameless window、event system |
| `tauri-plugin-single-instance` | v2 | single-instance 攔截 + argv relay |
| `tauri-plugin-cli` | v2 | CLI args 解析 |
| `tauri-plugin-fs` | v2 | frontend `readTextFile()`；capabilities 宣告 `fs:allow-read-text-file` |
| `monaco-editor` | ^0.47 | code display、language detection、delta decorations |
| `vite-plugin-monaco-editor` | latest | Monaco web worker bundling |
| `marked` | ^12 | markdown → HTML |
| `dompurify` | ^3 | sanitize marked output（防 XSS） |

## Test Strategy

### Unit Tests（mcp-server/）

| Test | 驗證 contract |
|------|--------------|
| `validator: valid code file` | 有效 .rs 路徑 → `{ valid: true, fileType: "code" }` |
| `validator: file not found` | ENOENT → `{ valid: false, errorMessage: /File not found/ }` |
| `validator: is directory` | isDirectory() → `errorMessage: /got a directory/` |
| `validator: file too large` | 11MB → `errorMessage: /too large/` |
| `validator: unsupported binary` | .exe → `fileType: "unsupported"` |
| `validator: image types` | .png/.jpg/.svg → `fileType: "image"` |
| `validator: markdown` | .md → `fileType: "markdown"` |
| `validator: code types` | .ts/.py/.rs → `fileType: "code"` |
| `relative path resolution` | "src/main.rs" + CLAUDE_PROJECT_DIR=/proj → absolutePath: "/proj/src/main.rs" |
| `launcher: resolveAppBinary` | 回傳路徑含 "target/release"，filename 為 "copilot-preview" |

### Integration Tests（按 PM Journey 索引）

IT 驗證 MCP tool call → validator → launcher → return message 完整因果鏈。Mock fs.stat 和 spawn。

| IT Case | Journey | 因果鏈驗證 |
|---------|---------|-----------|
| J1：valid .rs → spawn + success message | Journey 1 | spawn argv 含 binary path + absolutePath；return 含 filename |
| J2：line range → spawn args contain flags | Journey 2 | spawn argv 含 "--start-line" "50" "--end-line" "80" |
| J3：second call → spawn called again | Journey 3 | 連續兩次 show_file → spawn 被呼叫兩次，各帶正確 path |
| J4：.md → return contains "markdown" | Journey 4 | return 含 "markdown" |
| J5：.png → return contains "image" | Journey 5 | return 含 "image" |
| Error：file not found → UserError, no spawn | Alt flow | ENOENT → UserError，spawn count = 0 |
| Error：file too large → UserError, no spawn | Alt flow | 15MB → UserError，spawn = 0 |
| Error：is directory → UserError, no spawn | Alt flow | directory → UserError，spawn = 0 |
| Error：binary not found → UserError | System error | binary 不存在 → UserError "Preview app not found" |

### Frontend（手動驗收）

Renderer 與 DOM 深度耦合，不寫 unit test。驗收：
1. `cargo tauri dev` → DevTools inject handleFileRequest 測各 renderer
2. Phase 4/5 後用 MCP tool call 走完 Journey 1-5
3. Single-instance：兩個 terminal 快速先後執行 binary，確認視窗替換

## 開放問題

1. **Binary 路徑**：Phase 1-5 hardcode 到 `src-tauri/target/release/`。發布前改為環境變數 `COPILOT_PREVIEW_BINARY` 或安裝路徑。
2. **IPC 失敗偵測**：single-instance 無法區分 app 正常 vs hang。目前接受 timeout + 重試。Phase 6+ 可加 lock file health check。
3. **視窗位置記憶**：`tauri-plugin-window-state` 可解，Phase 2+ 可選加。
4. **Markdown toggle**：header 列右端放 `[Raw]` / `[Preview]` 按鈕。
