# discord-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets LLM agents manage Discord servers: messages, channels, roles, moderation, threads, voice, webhooks, events and more — through a small, token-efficient tool surface.

[繁體中文說明](README.zh-TW.md)

> **Status:** two modes are available. The default 4-tool *hybrid* mode, and a 2-tool **Code Mode** (`search` + `execute` over the official Discord OpenAPI spec, run in a QuickJS sandbox, read-only by default) — see [Code Mode](#code-mode) and [Roadmap](#roadmap).

## Why

| | discord-mcp | Typical Discord MCP servers |
|---|---|---|
| Tool definitions loaded up front | 4 tools, ~540 tokens | 15–220 tools |
| Voice: join channel and play audio | ✅ | ❌ |
| Moderation: ban / kick / timeout / audit log / AutoMod | ✅ | partial |
| Threads, scheduled events, webhooks, emoji & stickers | ✅ | partial |
| Batch several operations in one call | ✅ | rare |
| Bundled agent skill (usage guide for LLMs) | ✅ [`discord-skill/`](discord-skill/) | ❌ |

## Quick start

### 1. Create a bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → **Bot** → **Reset Token** and copy it.
2. Enable the **Server Members** and **Message Content** privileged intents. The bot requests both at login and fails to connect if either is off.
3. Invite the bot with the permissions you need (see [Bot permissions](#bot-permissions)).

### 2. Build

```bash
git clone https://github.com/bouob/discord-mcp.git
cd discord-mcp
npm install
npm run build
```

Requires Node.js 22 or later. If the voice dependency `@discordjs/opus` fails to compile, run `npm install --ignore-scripts` and then `npm run build`; everything except voice playback still works.

### 3. Register with your MCP client

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

Claude Code: `claude mcp add discord -e DISCORD_TOKEN=... -e DISCORD_GUILD_ID=... -- node /absolute/path/to/discord-mcp/dist/index-hybrid.js`

### 4. (Optional) Install the agent skill

```bash
bash scripts/install-skill.sh
```

The skill teaches the model which operations exist and how to call them, so it rarely needs `discord_help`.

## Tools

| Tool | Purpose |
|------|---------|
| `discord_execute` | Run one action: `{ operation, action, params }` |
| `discord_query` | Read data: `{ resource, filters?, limit? }` |
| `discord_batch` | Run several actions in order: `{ operations[], stopOnError? }` |
| `discord_help` | List operations, or the actions and params of one operation |

**Operations:** `message`, `dm`, `channel`, `category`, `role`, `member`, `server`, `voice`, `moderation`, `thread`, `webhook`, `event`, `emoji`, `sticker`, `invite`, `file`, `interactive`, `analytics`

**Query resources:** `messages`, `pinned_messages`, `message_history`, `attachments`, `dm_messages`, `channels`, `channel_structure`, `category_channels`, `members`, `member`, `roles`, `server`, `server_stats`, `server_widget`, `welcome_screen`, `events`, `invites`, `webhooks`, `emojis`, `stickers`, `automod_rules`, `voice_connections`, `bans`, `audit_logs`, `active_threads`

Example:

```json
{
  "operation": "message",
  "action": "send",
  "params": { "channelId": "123456789012345678", "content": "Hello from discord-mcp" }
}
```

Full reference: [`discord-skill/reference/api-actions.md`](discord-skill/reference/api-actions.md). Guide for LLM agents: [`docs/llm-usage.md`](docs/llm-usage.md).

## Code Mode

Code Mode replaces the per-action tools with two: the model writes a short JavaScript function, it runs in a sandbox, and only the final return value comes back. It covers every bot-token REST endpoint in Discord's official OpenAPI spec (v10, 238 operations), so nothing needs a hand-written wrapper.

Enable it with `DISCORD_MCP_MODE=codemode`:

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

| Tool | Purpose |
|------|---------|
| `discord_search` | Run JavaScript over the OpenAPI spec (`spec.paths`, `spec.schemas`) to find endpoints, parameters and bodies |
| `discord_execute` | Run JavaScript that calls `discord.request({ method, path, query?, body?, reason? })`; also `permissions.names/bits/effective` and `defaultGuildId` |

Both tool definitions together are about 2,400 characters. Multi-step flows (list, filter, act) run in one call and only the returned summary reaches the model.

**Safety defaults**

- **Read-only by default.** Only `GET` passes until you set `CODEMODE_READ_ONLY=false`.
- **Allow/deny by `operationId`** (`CODEMODE_ALLOW`, `CODEMODE_DENY`, `*` wildcards). Deny always wins. Paths that are not in the spec are rejected.
- **Scope limits.** `CODEMODE_SCOPE_GUILDS` and `CODEMODE_SCOPE_CATEGORIES` restrict which servers and categories may be touched. With `CODEMODE_SCOPE_GUILDS` set, writes that name no guild or channel are denied.
- **Dangerous-permission guard.** Requests that grant Administrator, Manage Server, Manage Roles or Manage Webhooks (new roles, overwrites, adding a role that has them) are denied unless `CODEMODE_ALLOW_DANGEROUS_PERMS=true`.
- **Limits per `discord_execute`:** 50 requests, 30 s, 64 MB, 24,000 characters of output.
- **The token never enters the sandbox.** It stays in the host process; the sandbox has no network, filesystem or `require`.
- **Audit log.** Every request writes one line to stderr (`[codemode] <time> <operationId> <METHOD> <path> <status> <ms>`); `reason` becomes Discord's audit-log reason.
- **Stdio only.** `MCP_TRANSPORT=sse` is hybrid-only for now. Without `DISCORD_TOKEN` the server still lists its tools and `discord_search` works; `discord_execute` reports the missing token. No Gateway login is needed.

`ALLOWED_ACTIONS` / `DENIED_ACTIONS` do not affect Code Mode. Variables and evaluation order: [`docs/configuration.md`](docs/configuration.md). Usage guide for models: [`docs/llm-usage.md`](docs/llm-usage.md).

## Configuration

See [`docs/configuration.md`](docs/configuration.md) for every environment variable and transport option. The essentials:

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Bot token |
| `DISCORD_GUILD_ID` | No | Default server, used when an action omits `guildId` |
| `MCP_TRANSPORT` | No | `stdio` (default) or `sse` |
| `DISCORD_MCP_MODE` | No | `hybrid` (default), `codemode` or `legacy` |
| `DISCORD_MCP_LEGACY` | No | `true` is the same as `DISCORD_MCP_MODE=legacy` (93 tools) |

## Bot permissions

Grant only what you use:

| Feature | Permissions |
|---------|-------------|
| Messages | View Channels, Send Messages, Read Message History, Manage Messages |
| Channels & roles | Manage Channels, Manage Roles |
| Moderation | Kick Members, Ban Members, Moderate Members, View Audit Log, Manage Server (AutoMod) |
| Voice | Connect, Speak |
| Webhooks, emoji, events | Manage Webhooks, Manage Expressions, Manage Events |

## Security

- The bot can do anything its Discord permissions allow. Give it a dedicated role with the minimum permissions.
- `file.upload` reads files from the machine running the server. It is refused unless `DISCORD_MCP_UPLOAD_DIR` is set, and then only files inside that directory can be uploaded. Point it at a directory that holds nothing private.
- `ALLOWED_ACTIONS` / `DENIED_ACTIONS` are **not enforced yet** in hybrid mode. Do not rely on them. Code Mode (`DISCORD_MCP_MODE=codemode`) adds an enforced policy layer, read-only by default.
- `MCP_TRANSPORT=sse` has no authentication. It listens on `127.0.0.1` only, sends no CORS headers and rejects requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`; any local process can still connect.

## Known issues

- `moderation` (`ban`, `unban`, `kick`, `timeout`, `remove_timeout`), every `thread` action, and the `bans` / `audit_logs` / `active_threads` queries can pass arguments in the wrong order. Use Code Mode for these actions.
- `limit` and `content` are renamed internally to `count` and `message`, so actions that expect `limit` or `content` (e.g. `analytics.export_chat`, `interactive.send_button`) can silently ignore them.
- `discord_batch` runs sequentially and is not transactional: completed steps are not rolled back.
- `analytics.export_chat` fetches at most 100 messages and returns a 2,000-character preview instead of a file.
- `interactive.send_modal` is not implemented; buttons and select menus are sent but clicks are not handled.
- With `ENABLE_LOGGING=true`, `INFO`/`DEBUG` logs go to stdout and break the stdio transport. Use `LOG_LEVEL=warn` or the SSE transport.

These are addressed by Code Mode rather than patched one by one.

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| P0 | Sandbox and spec feasibility (QuickJS bridging, limits, spec size) | ✅ Done |
| P1 | Code Mode: `discord_search` + `discord_execute` over all 238 bot-token REST endpoints; policy layer (allow/deny, read-only default, scope limits, dangerous-permission guard) | Done |
| P2 | Voice host functions, rewritten agent skill, file export | Planned |
| P3 | Watcher: real-time message monitoring and malicious-link detection | Planned |

## License

[MIT](LICENSE). `spec/discord-openapi.json` is a snapshot of [discord/discord-api-spec](https://github.com/discord/discord-api-spec) (MIT, © Discord Inc.). Forked from [sashathelambo/discord-mcp](https://github.com/sashathelambo/discord-mcp) (MIT, © 2025 Dr.vova); the original copyright notice is kept in [LICENSE](LICENSE).
