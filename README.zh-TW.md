# discord-mcp

讓 LLM agent 管理 Discord 伺服器的 [Model Context Protocol](https://modelcontextprotocol.io/) server：訊息、頻道、身分組、管理（ban／kick／禁言）、討論串、語音、webhook、活動等，用少量工具、低 token 成本完成。

[English](README.md)

> **狀態：** 提供兩種模式：預設的 4 工具 *hybrid* 模式，以及 2 工具的 **Code Mode**（以 `search` + `execute` 操作 Discord 官方 OpenAPI 規格，在 QuickJS 沙盒中執行，預設唯讀），見 [Code Mode](#code-mode) 與[路線圖](#路線圖)。

## 特色

| | discord-mcp | 常見的 Discord MCP |
|---|---|---|
| 一開始載入的工具定義 | 4 個工具，約 540 token | 15–220 個工具 |
| 語音：加入頻道並播放音訊 | ✅ | ❌ |
| 管理：ban／kick／禁言／稽核日誌／AutoMod | ✅ | 部分 |
| 討論串、排程活動、webhook、表情與貼圖 | ✅ | 部分 |
| 一次呼叫執行多個操作 | ✅ | 少見 |
| 附帶給 LLM 的使用手冊（agent skill） | ✅ [`discord-skill/`](discord-skill/) | ❌ |

## 快速開始

### 1. 建立 bot

1. 到 [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → **Bot** → **Reset Token**，複製 token。
2. 開啟 **Server Members** 與 **Message Content** 兩個特權 intent。Bot 登入時兩個都會要求，任一個沒開就連不上。
3. 依需要的權限邀請 bot 進伺服器（見 [Bot 權限](#bot-權限)）。

### 2. 建置

```bash
git clone https://github.com/bouob/discord-mcp.git
cd discord-mcp
npm install
npm run build
```

需要 Node.js 22 以上。語音套件 `@discordjs/opus` 編譯失敗時，改跑 `npm install --ignore-scripts` 再 `npm run build`，除了語音播放之外都能用。

### 3. 註冊到 MCP client

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/path/to/discord-mcp/dist/index-hybrid.js"],
      "env": {
        "DISCORD_TOKEN": "your-bot-token",
        "DISCORD_GUILD_ID": "your-default-server-id"
      }
    }
  }
}
```

Claude Code：`claude mcp add discord -e DISCORD_TOKEN=... -e DISCORD_GUILD_ID=... -- node /absolute/path/to/discord-mcp/dist/index-hybrid.js`

### 4.（選用）安裝 agent skill

```bash
bash scripts/install-skill.sh
```

skill 會告訴模型有哪些操作、怎麼呼叫，減少呼叫 `discord_help` 的次數。

## 工具

| 工具 | 用途 |
|------|------|
| `discord_execute` | 執行單一動作：`{ operation, action, params }` |
| `discord_query` | 讀取資料：`{ resource, filters?, limit? }` |
| `discord_batch` | 依序執行多個動作：`{ operations[], stopOnError? }` |
| `discord_help` | 列出所有操作，或某個操作的動作與參數 |

完整參考：[`discord-skill/reference/api-actions.md`](discord-skill/reference/api-actions.md)。給 LLM agent 的手冊：[`docs/llm-usage.md`](docs/llm-usage.md)（英文）。

## Code Mode

Code Mode 以兩個工具取代逐一動作的工具：模型寫一小段 JavaScript，在沙盒內執行，只有最後的回傳值會回到模型。它涵蓋 Discord 官方 OpenAPI 規格（v10）中所有 bot token 可用的 REST endpoint（238 個 operation），不需要手寫 wrapper。

設定 `DISCORD_MCP_MODE=codemode` 啟用：

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/path/to/discord-mcp/dist/index-hybrid.js"],
      "env": {
        "DISCORD_MCP_MODE": "codemode",
        "DISCORD_TOKEN": "your-bot-token",
        "DISCORD_GUILD_ID": "your-default-server-id",
        "CODEMODE_READ_ONLY": "false"
      }
    }
  }
}
```

| 工具 | 用途 |
|------|------|
| `discord_search` | 對 OpenAPI 規格（`spec.paths`、`spec.schemas`）執行 JavaScript，查 endpoint、參數與 body |
| `discord_execute` | 執行呼叫 `discord.request({ method, path, query?, body?, reason? })` 的 JavaScript；另有 `permissions.names/bits/effective` 與 `defaultGuildId` |

兩個工具定義合計約 2,400 字元。多步驟流程（列出、篩選、動作）在一次呼叫內完成，只有回傳的摘要會進模型 context。

**安全預設**

- **預設唯讀。** 設 `CODEMODE_READ_ONLY=false` 之前只放行 `GET`。
- **依 `operationId` 允許／拒絕**（`CODEMODE_ALLOW`、`CODEMODE_DENY`，支援 `*` 萬用字元）。拒絕永遠優先；不在規格內的路徑一律拒絕。
- **範圍限定。** `CODEMODE_SCOPE_GUILDS`、`CODEMODE_SCOPE_CATEGORIES` 限制可操作的伺服器與分類。設了 `CODEMODE_SCOPE_GUILDS` 後，沒有指明伺服器或頻道的寫入請求會被拒絕。
- **危險權限檢查。** 授予 Administrator、Manage Server、Manage Roles、Manage Webhooks 的請求（建立身分組、權限覆寫、把含這些權限的身分組加給成員）一律拒絕，除非設 `CODEMODE_ALLOW_DANGEROUS_PERMS=true`。
- **每次 `discord_execute` 上限：** 50 個請求、30 秒、64 MB、輸出 24,000 字元。
- **token 不會進沙盒。** token 只在 host 程序內；沙盒沒有網路、檔案系統與 `require`。
- **稽核紀錄。** 每個請求在 stderr 寫一行（`[codemode] <時間> <operationId> <METHOD> <path> <status> <ms>`）；`reason` 會成為 Discord 稽核日誌的原因。
- **僅支援 stdio。** `MCP_TRANSPORT=sse` 目前只適用 hybrid。沒有 `DISCORD_TOKEN` 時伺服器仍會列出工具、`discord_search` 可用，`discord_execute` 會回報缺少 token。不需要登入 Gateway。

`ALLOWED_ACTIONS`／`DENIED_ACTIONS` 對 Code Mode 無效。變數與判定順序見 [`docs/configuration.md`](docs/configuration.md)（英文），模型使用手冊見 [`docs/llm-usage.md`](docs/llm-usage.md)（英文）。

## 設定

所有環境變數見 [`docs/configuration.md`](docs/configuration.md)（英文）。必要項目：

| 變數 | 必填 | 說明 |
|------|------|------|
| `DISCORD_TOKEN` | 是 | Bot token |
| `DISCORD_GUILD_ID` | 否 | 預設伺服器；動作沒帶 `guildId` 時使用 |
| `MCP_TRANSPORT` | 否 | `stdio`（預設）或 `sse` |
| `DISCORD_MCP_MODE` | 否 | `hybrid`（預設）、`codemode` 或 `legacy` |
| `DISCORD_MCP_LEGACY` | 否 | `true` 等同 `DISCORD_MCP_MODE=legacy`（93 個工具） |

## Bot 權限

只給用得到的：

| 功能 | 權限 |
|------|------|
| 訊息 | View Channels、Send Messages、Read Message History、Manage Messages |
| 頻道與身分組 | Manage Channels、Manage Roles |
| 管理 | Kick Members、Ban Members、Moderate Members、View Audit Log、Manage Server（AutoMod） |
| 語音 | Connect、Speak |
| Webhook、表情、活動 | Manage Webhooks、Manage Expressions、Manage Events |

## 安全

- bot 的能力上限就是它在 Discord 的權限。給它一個專用身分組，權限最小化。
- `file.upload` 會讀取執行伺服器那台機器上的檔案。沒設 `DISCORD_MCP_UPLOAD_DIR` 時一律拒絕，設了也只能上傳該目錄內的檔案。請指向不含私人資料的目錄。
- hybrid 模式**尚未實際套用** `ALLOWED_ACTIONS`／`DENIED_ACTIONS`，不要依賴它們。Code Mode（`DISCORD_MCP_MODE=codemode`）有真正生效的權限層，預設唯讀。
- `MCP_TRANSPORT=sse` 沒有驗證。只監聽 `127.0.0.1`、不送 CORS 標頭，`Host` 不是 `127.0.0.1:<port>` 或 `localhost:<port>` 的請求一律拒絕；本機任何程式仍可連線。

## 已知問題

- `moderation` 的 `ban`、`unban`、`kick`、`timeout`、`remove_timeout`，所有 `thread` 動作，以及 `bans`／`audit_logs`／`active_threads` 查詢，參數可能錯位。這些動作請改用 Code Mode。
- `limit` 與 `content` 在內部會被改名成 `count` 與 `message`，需要這兩個參數的動作（如 `analytics.export_chat`、`interactive.send_button`）可能會直接忽略它們。
- `discord_batch` 依序執行、沒有交易性：已完成的步驟不會回復。
- `analytics.export_chat` 最多抓 100 則訊息，只回傳 2,000 字預覽，不產生檔案。
- `interactive.send_modal` 尚未實作；按鈕與選單送得出去，但使用者點選後不會有反應。
- `ENABLE_LOGGING=true` 時，`INFO`／`DEBUG` 日誌會寫到 stdout，破壞 stdio 傳輸。請設 `LOG_LEVEL=warn` 或改用 SSE。

這些問題由 Code Mode 一併解決，不逐一修補。

## 路線圖

| 階段 | 範圍 | 狀態 |
|------|------|------|
| P0 | 沙盒與規格可行性（QuickJS 橋接、限制、規格大小） | ✅ 完成 |
| P1 | Code Mode：`discord_search` + `discord_execute` 涵蓋全部 238 個 bot token 可用的 REST endpoint；權限層（允許／拒絕、預設唯讀、範圍限定、危險權限檢查） | 完成 |
| P2 | 語音 host 函式、改寫 agent skill、檔案匯出 | 規劃中 |
| P3 | Watcher：即時訊息監控與惡意連結偵測 | 規劃中 |

## 授權

[MIT](LICENSE)。`spec/discord-openapi.json` 是 [discord/discord-api-spec](https://github.com/discord/discord-api-spec) 的快照（MIT，© Discord Inc.）。本專案 fork 自 [sashathelambo/discord-mcp](https://github.com/sashathelambo/discord-mcp)（MIT，© 2025 Dr.vova），原著作權聲明保留在 [LICENSE](LICENSE)。
