# File Preview — Claude Code 檔案預覽工具

## 背景與問題

Claude Code 的 Read tool 讀取檔案後，內容只進入 AI 的 context window，使用者完全看不到。如果使用者想看檔案內容，唯一的方式是讓 Claude 用 inference 逐字輸出，這既慢又浪費 token。

Copilot CLI 有類似的 `view` tool，但它能直接在 TUI 中 render 內容，因為它自己控制整個 UI（基於 Ink）。Claude Code 的 UI 是封閉的，無法注入自訂顯示元件。

不做的話，使用者每次想看檔案都要：(1) 浪費 inference 讓 Claude 輸出，或 (2) 自己開另一個視窗手動找檔案。

## 使用者角色

**Claude Code 使用者**：開發者，使用 Claude Code CLI/Desktop/Web 進行軟體開發。核心動機是在 AI 對話過程中快速預覽 Claude 正在操作的檔案，不中斷工作流。

## 需求情境

- Claude Code 使用者：When 我請 Claude 讀一個檔案後想自己也看看內容, I want to 不離開對話流就能看到檔案, so I can 快速確認 Claude 的理解是否正確並繼續指令
- Claude Code 使用者：When Claude 提到某個檔案的特定區段（例如「第 50-80 行有個 bug」）, I want to 直接看到那幾行被標記出來, so I can 立刻定位問題而不用自己開 editor 去找

## 設計意圖

- **MCP tool + 獨立 app** → 因為 Claude Code UI 是封閉的，唯一能在 AI 呼叫時觸發使用者可見行為的方式是 MCP tool spawn 外部 process
- **Tauri 而非 Swift** → 雖然目前只用 macOS，但 Tauri 跨平台，未來可支援 Linux/Windows 使用者
- **Monaco Editor 而非 highlight.js** → Monaco 內建行號、syntax highlighting、搜尋、line range highlight，不用自己刻。Bundle size 較大（~2-3MB）但桌面 app 不在意
- **單視窗替換而非多視窗** → 避免桌面被彈窗淹沒，保持 Quick Look 的「看完即走」體驗
- **Quick Look 風格（無 title bar、ESC 關閉）** → 這是預覽工具不是 editor，操作要極輕量

## User Journey

### Journey 1：使用者 — 預覽程式碼檔案

前置條件：Claude Code 已安裝並設定 MCP server，Tauri preview app 已 build

1. 使用者在 Claude Code 中說「讓我看 src/main.rs」
2. Claude 呼叫 MCP tool `show_file(path: "src/main.rs")` 
3. MCP server spawn Tauri app（或透過 IPC 通知已開啟的 instance）傳入檔案路徑
4. Tauri 視窗彈出 → 顯示 src/main.rs 的內容，Monaco Editor 唯讀模式，自動偵測語言，dark theme，有行號
5. Claude 收到回傳「已開啟 src/main.rs 預覽 (245 lines)」→ 對話繼續，不中斷
6. 使用者按 ESC 或點擊視窗外 → 視窗關閉

### Journey 2：使用者 — 預覽指定行範圍

前置條件：同 Journey 1

1. 使用者在 Claude Code 中說「讓我看 utils.ts 第 50 到 80 行」
2. Claude 呼叫 `show_file(path: "utils.ts", startLine: 50, endLine: 80)`
3. Tauri 視窗彈出 → 顯示完整檔案，但自動捲動到第 50 行，第 50-80 行有明顯的背景色 highlight
4. 使用者可以上下捲動看其他部分，highlight 區域保持標記

### Journey 3：使用者 — 連續預覽多個檔案

前置條件：Preview 視窗已開啟顯示 a.py

1. 使用者說「再讓我看 b.ts」
2. Claude 呼叫 `show_file(path: "b.ts")`
3. 同一個視窗的內容替換為 b.ts → a.py 消失
4. 使用者不需要手動關閉舊視窗

### Journey 4：使用者 — 預覽 Markdown 檔案

前置條件：同 Journey 1

1. 使用者說「讓我看 README.md」
2. Claude 呼叫 `show_file(path: "README.md")`
3. Tauri 視窗彈出 → 偵測到 .md 副檔名，使用 markdown render 模式顯示（rendered HTML，非原始碼）
4. 使用者可以切換到「原始碼模式」查看 raw markdown（可選 toggle）

### Journey 5：使用者 — 預覽圖片

前置條件：同 Journey 1

1. 使用者說「讓我看 screenshot.png」
2. Claude 呼叫 `show_file(path: "screenshot.png")`
3. Tauri 視窗彈出 → 顯示圖片，自動 fit 視窗大小，支援 .png/.jpg/.svg
4. 使用者可以捲動/縮放查看細節

## 替代流程

- **檔案不存在**：MCP tool 回傳錯誤訊息「File not found: [path]」，不 spawn 視窗。Claude 收到錯誤後告知使用者
- **二進位檔案（非文字、非圖片）**：MCP tool 回傳「Unsupported file type: [ext]」，不 spawn 視窗
- **檔案過大（>10MB）**：MCP tool 回傳警告「File too large for preview (12MB). Consider using line range.」，不 spawn 視窗
- **視窗已存在**：不開新視窗，透過 IPC 更新現有視窗的內容

## 錯誤情境

### 系統錯誤
- Tauri app binary 不存在或無法啟動 → MCP tool 回傳「Preview app not found. Run 'npm run build' in copilot-preview/」
- IPC 連線失敗（app 掛了但 process 還在） → Kill 舊 process，重新 spawn

### 使用者誤操作
- 傳入目錄而非檔案 → 回傳「Expected a file path, got a directory: [path]」
- 傳入相對路徑 → MCP server 以 Claude Code 的 working directory 為基準解析成絕對路徑

### 惡意行為
- Path traversal（`../../etc/passwd`） → MCP server 解析後檢查路徑是否在合理範圍內（但這是本機工具，使用者本來就有 file system 存取權，低風險）

## Out of Scope

- **檔案編輯**：這是 previewer 不是 editor，不需要寫入功能
- **PDF 預覽**：第一版不支援，之後可加
- **Terminal 內 render**：已確認 Claude Code 的 TUI 無法注入自訂元件
- **多 tab / 歷史**：第一版替換內容即可，tab 切換之後視需求加
- **遠端檔案**：只預覽本機檔案

## 整合點

- **Claude Code MCP**：MCP server 需要在 Claude Code 的 settings 中註冊
- **Tauri app**：MCP server 透過 spawn child process 或 IPC 啟動/通訊
- **Monaco Editor**：前端引入 monaco-editor npm package，需要處理 web worker 載入
- **marked.js**：Markdown render 用，只在 .md 檔案時載入

## Acceptance Criteria

### Journey 1：預覽程式碼檔案
- Given MCP server 已啟動且 preview app 已 build
  When Claude 呼叫 show_file(path: "src/main.rs")
  Then 彈出視窗顯示 main.rs 內容，有 syntax highlighting 和行號，語言自動偵測為 Rust

- Given 視窗已開啟
  When 使用者按 ESC
  Then 視窗關閉

### Journey 2：行範圍 highlight
- Given 檔案有 200 行
  When Claude 呼叫 show_file(path: "utils.ts", startLine: 50, endLine: 80)
  Then 視窗自動捲動到第 50 行，第 50-80 行有明顯的背景色區別

### Journey 3：連續預覽
- Given preview 視窗已開啟顯示 a.py
  When Claude 呼叫 show_file(path: "b.ts")
  Then 同一視窗內容替換為 b.ts，不開新視窗

### Journey 4：Markdown 預覽
- Given 檔案為 .md 副檔名
  When Claude 呼叫 show_file(path: "README.md")
  Then 視窗以 rendered markdown 模式顯示（標題、列表、code block 有格式）

### Journey 5：圖片預覽
- Given 檔案為 .png/.jpg/.svg
  When Claude 呼叫 show_file(path: "screenshot.png")
  Then 視窗顯示圖片，自動 fit 視窗大小

### 錯誤情境
- Given 檔案路徑不存在
  When Claude 呼叫 show_file(path: "nonexistent.txt")
  Then MCP tool 回傳錯誤訊息，不彈出視窗

- Given 檔案大於 10MB
  When Claude 呼叫 show_file(path: "huge-log.txt")
  Then MCP tool 回傳檔案過大警告，不彈出視窗

## 開放問題

1. **Monaco Editor 的 Markdown preview 模式**：Monaco 本身不 render markdown，需要在 .md 時切換成 marked.js render 的 HTML view。兩種 view 之間的切換 UX 待 Architecture 階段決定
2. **IPC 機制**：MCP server 與 Tauri app 之間的通訊方式（stdin/stdout、unix socket、HTTP localhost）待 Architecture 階段決定
3. **視窗大小與位置**：預設尺寸、是否記住上次位置、多螢幕行為 — 待實作階段實測調整
