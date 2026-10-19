# Configuration

All settings are environment variables. Put them in the MCP client's `env` block, or in a `.env` file in the directory the server is started from. That is the process working directory, which is often not the package directory. See [`.env.example`](../.env.example).

## Discord

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | Yes | — | Bot token from the Developer Portal |
| `DISCORD_GUILD_ID` | No | — | Default server ID, used when an action omits `guildId`. Without it, every server-scoped action must pass `guildId`. |
| `DISCORD_MCP_UPLOAD_DIR` | No | — | Directory that `file.upload` may read local files from. Unset: local uploads are refused (http(s) URLs still work). Relative `filePath` values resolve against it; paths that resolve outside it, including through symlinks, are refused. |

## Server mode and transport

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_MCP_MODE` | `hybrid` | `hybrid` (4 tools), `codemode` (2 tools: `discord_search`, `discord_execute`) or `legacy` (93 tools). Any other value exits with an error. |
| `DISCORD_MCP_LEGACY` | `false` | `true` is the same as `DISCORD_MCP_MODE=legacy`; ignored when `DISCORD_MCP_MODE` is set |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `sse` (hybrid mode only; Code Mode is stdio only) |
| `MCP_PORT` | `3000` | SSE port (hybrid mode) |
| `MCP_HTTP_PORT` / `PORT` | — | HTTP port (legacy mode) |

The SSE endpoint (`GET /sse`, then `POST /message?sessionId=…`) has **no authentication**. It listens on `127.0.0.1` only, sends no CORS headers, and rejects requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`. One client at a time: a new `GET /sse` replaces the previous session.

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_LOGGING` | `false` | Enables the internal logger. **`INFO` and `DEBUG` go to stdout and corrupt the stdio transport** — enable only with `MCP_TRANSPORT=sse`, or set `LOG_LEVEL=warn` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Read but not yet enforced

These variables are parsed, but the hybrid execution path does not apply them yet. They have no effect on Code Mode; use the Code Mode policy settings below.

| Variable | Intended behavior |
|----------|-------------------|
| `ALLOWED_ACTIONS` | Comma-separated allowlist of method names (e.g. `send_message,read_messages`) |
| `DENIED_ACTIONS` | Comma-separated denylist |
| `RATE_LIMIT_PROTECTION` | Extra client-side rate limiting (discord.js built-in REST rate limiting always applies) |
| `MAX_RETRIES`, `RETRY_DELAY`, `TIMEOUT` | Retry and timeout tuning |

## Code Mode policy

Set `DISCORD_MCP_MODE=codemode`. Code Mode needs `DISCORD_TOKEN` only for `discord_execute`; `DISCORD_GUILD_ID` is exposed to code as `defaultGuildId` (`null` when unset). Patterns use `*` as a wildcard; lists are comma-separated.

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEMODE_READ_ONLY` | `true` | Only `GET` requests are allowed. Set `false` to allow writes. |
| `CODEMODE_ALLOW` | — | Allowlist of OpenAPI `operationId`s (e.g. `list_*,get_*,create_message`). When set, everything else is denied. |
| `CODEMODE_DENY` | — | Denylist of `operationId`s (e.g. `ban_user_from_guild,delete_*`). Always wins over the allowlist. |
| `CODEMODE_SCOPE_GUILDS` | — | Only these server IDs may be touched. Writes whose guild cannot be determined are denied. |
| `CODEMODE_SCOPE_CATEGORIES` | — | Channel writes are limited to channels under these category IDs |
| `CODEMODE_ALLOW_DANGEROUS_PERMS` | `false` | Allow requests that grant Administrator, Manage Server, Manage Roles or Manage Webhooks |

### Evaluation order

A request stops at the first gate that rejects it; nothing is sent to Discord when a gate rejects.

1. Path and method must match an operation in the bundled spec (otherwise denied; this also blocks `..` tricks and OAuth2-only endpoints)
2. `CODEMODE_DENY` match
3. `CODEMODE_READ_ONLY` and the method is not `GET`
4. `CODEMODE_ALLOW` is set and nothing matches
5. Scope limits (`CODEMODE_SCOPE_GUILDS`, `CODEMODE_SCOPE_CATEGORIES`)
6. Dangerous-permission guard

### Limits and logging

| Limit | Value |
|-------|-------|
| Requests per `discord_execute` | 50 (`permissions.effective` lookups count too) |
| Run time | 30 s |
| Sandbox memory | 64 MB |
| Output | 24,000 characters, then truncated with a marker |

Each request writes one audit line to **stderr**: `[codemode] <ISO time> <operationId> <METHOD> <path> <status> <ms>ms`. Denied requests are logged with status `DENIED`. Webhook and interaction tokens in paths are masked. Code Mode never writes to stdout, which carries the MCP protocol.

To refresh the bundled OpenAPI snapshot, run `npm run update-spec`.
