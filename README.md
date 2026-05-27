# quick-look

Claude Code 的 MCP 工具——彈出浮動視窗預覽檔案（程式碼語法高亮、Markdown 渲染、圖片顯示），不消耗 inference token。

## 為什麼需要

Claude Code 讀檔案後，你看不到內容，除非讓 Claude 逐字輸出（慢又浪費 token）。這個工具讓 Claude 呼叫 `show_file`，直接彈出原生 macOS 預覽面板。

## 架構

```
Claude Code ──MCP──> mcp-server (Node.js/FastMCP)
                         │
                         └──spawn──> swift-app (NSPanel + WKWebView)
                                         │
                                         └──loads──> dist/ (Vite + Monaco Editor)
```

- **mcp-server/** — MCP server，透過 stdio transport 暴露 `show_file` tool
- **swift-app/** — 原生 macOS 浮動面板（NSPanel + WKWebView）
- **src/** — 前端：Monaco Editor（程式碼）、marked.js（Markdown）、原生 img（圖片）

## 環境需求

- macOS 13+
- Node.js 18+
- pnpm
- Xcode Command Line Tools（需要 `swiftc`）

## 安裝

```bash
cd ~/Desktop/quick-look
pnpm install
cd mcp-server && pnpm install && cd ..

# 建置全部
pnpm build                              # 前端 (dist/)
cd mcp-server && pnpm build && cd ..    # MCP server
cd swift-app && make build && cd ..     # 原生 app
```

## 設定 Claude Code

在 `~/.claude/settings.json` 的 `mcpServers` 加入：

```json
{
  "mcpServers": {
    "quick-look": {
      "command": "node",
      "args": ["/path/to/quick-look/mcp-server/dist/index.js"]
    }
  }
}
```

重啟 Claude Code 載入 MCP server。

## 使用方式

Claude Code 現在可以呼叫 `show_file` tool：

```
show_file(path: "/path/to/file.ts", startLine: 10, endLine: 20)
```

或直接跟 Claude 說「show me this file」，它會自動使用。

## 快捷鍵

| 按鍵 | 功能 |
|------|------|
| Tab | 在開啟的 tab 之間切換 |
| `` ` ``（backtick） | 關閉預覽面板 |
| Cmd+F | 搜尋當前檔案（僅程式碼） |
| Escape | 退出搜尋模式 |

Tab 和 backtick 透過 CGEvent tap 在面板可見時攔截。可能需要授權「輔助使用」權限（系統設定 > 隱私權與安全性 > 輔助使用）。

## 支援的檔案類型

| 類型 | 渲染器 | 功能 |
|------|--------|------|
| 程式碼（.ts, .js, .py, .rs, .go 等） | Monaco Editor | 語法高亮、行號、行範圍標記、Cmd+F 搜尋 |
| Markdown（.md, .mdx） | marked.js + DOMPurify | 渲染 HTML，可切換 Raw/Preview |
| 圖片（.png, .jpg, .svg, .gif 等） | 原生 img | 置中顯示 |

## 開發

```bash
# 前端 dev server（hot reload）
pnpm dev

# 跑測試
pnpm vitest run                          # 前端測試
cd mcp-server && pnpm vitest run         # MCP server 測試

# 改動後重新建置
pnpm build && cd swift-app && make build
```

## 運作原理

- **Non-activating panel**：預覽浮在所有視窗上方，不搶走終端機的鍵盤焦點
- **Single instance**：Lock file + DistributedNotificationCenter 確保只有一個面板，新檔案以 tab 開啟
- **Search mode**：Cmd+F 暫時 activate app 接收鍵盤輸入，Escape 恢復焦點到前一個 app
- **CGEvent tap**：在系統層攔截 Tab/backtick/Cmd+F，即使面板沒有焦點也能運作
