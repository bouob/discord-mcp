# Discord MCP Server - Hybrid Architecture

> **⚠️ SECURITY WARNING**: This project handles Discord bot tokens and server access. Please read our [Security Policy](SECURITY.md) before using or contributing.

A Model Context Protocol (MCP) server for Discord API integration with **Claude Skill hybrid architecture**.

## Why This Fork?

The original [sashathelambo/discord-mcp](https://github.com/sashathelambo/discord-mcp) provides 93 comprehensive Discord tools. However, loading all 93 tool definitions consumes **~17,200 tokens** of context on every conversation start - before any actual work begins.

This fork introduces a **MCP + Claude Skill hybrid architecture** that:

| Approach | Tools Loaded | Token Usage | Reduction |
|----------|--------------|-------------|-----------|
| Original MCP | 93 tools | ~17,200 tokens | - |
| **Hybrid Mode** | 4 tools | ~2,000 tokens | **88%** |

### How It Works

1. **MCP Layer**: Exposes only 4 core tools (`discord_execute`, `discord_query`, `discord_batch`, `discord_help`)
2. **Skill Layer**: Progressive documentation loaded on-demand when Claude needs specific guidance
3. **Result**: Same 93 operations available, but only ~2,000 tokens consumed at startup

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Discord bot token ([setup guide](#discord-bot-setup))

### Installation

```bash
# Clone the repository
git clone https://github.com/bouob/discord-mcp.git
cd discord-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### Claude Desktop Configuration

#### Step 1: Configure MCP Server

Edit `~/.claude/claude_desktop_config.json` (macOS/Linux) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/path/to/discord-mcp/dist/index-hybrid.js"],
      "env": {
        "DISCORD_TOKEN": "your_bot_token",
        "DISCORD_GUILD_ID": "your_default_guild_id"
      }
    }
  }
}
```

#### Step 2: Install Skill (Recommended)

The Skill provides progressive documentation that Claude loads on-demand:

```bash
# Using install script
./scripts/install-skill.sh

# Or manually copy
cp -r discord-skill ~/.claude/skills/discord-skill
```

#### Step 3: Restart Claude

After restart, Claude will:
1. Load MCP Server (4 core tools, ~2,000 tokens)
2. Auto-discover Skill documentation (loaded on-demand)

### Development Mode

```bash
npm run dev          # Hybrid mode (4 tools) - RECOMMENDED
npm run dev:legacy   # Legacy mode (93 tools)
```

## Usage

### Hybrid Mode (Default)

The hybrid architecture uses 4 core tools:

| Tool | Purpose | Example |
|------|---------|---------|
| `discord_execute` | Execute operations | Send message, create channel, edit role |
| `discord_query` | Query data | List members, get messages, fetch roles |
| `discord_batch` | Multiple operations | Create channel + assign roles atomically |
| `discord_help` | Get operation help | List available actions for an operation |

#### Examples

```json
// Send a message
{
  "operation": "message",
  "action": "send",
  "params": {
    "channelId": "123456789",
    "content": "Hello World!"
  }
}

// Query members with limit (number or string both work)
{
  "resource": "members",
  "filters": { "guildId": "123456789" },
  "limit": 100
}

// Batch operations
{
  "operations": [
    { "operation": "channel", "action": "create", "params": { "name": "announcements", "type": "text" } },
    { "operation": "role", "action": "create", "params": { "name": "Member", "color": "#5865F2" } }
  ]
}
```

#### Available Operations

| Operation | Actions |
|-----------|---------|
| `message` | send, edit, delete, bulk_delete, pin, unpin, react, unreact, crosspost |
| `dm` | send, edit, delete |
| `channel` | create, edit, delete, move, set_position, set_positions, set_private |
| `category` | create, edit, delete, set_position |
| `role` | create, edit, delete, set_positions, add_to_member, remove_from_member |
| `member` | edit, search |
| `server` | edit, get_info, get_stats |
| `voice` | join, leave, play, stop, set_volume |
| `moderation` | create_rule, edit_rule, delete_rule |
| `webhook` | create, delete, send |
| `event` | create, edit, delete |
| `emoji` | create, delete |
| `sticker` | create, delete |
| `invite` | create, delete |
| `file` | upload |
| `interactive` | send_embed, send_button, send_select_menu |
| `analytics` | export_chat |

For detailed documentation, see [discord-skill/](discord-skill/) folder.

### Legacy Mode

For backward compatibility with the original 93 tools:

```bash
DISCORD_MCP_LEGACY=true npm start
```

Or in Claude config:
```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/path/to/discord-mcp/dist/index-hybrid.js"],
      "env": {
        "DISCORD_TOKEN": "your_bot_token",
        "DISCORD_MCP_LEGACY": "true"
      }
    }
  }
}
```

## Configuration

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Copy the bot token
4. Enable required intents (Server Members, Message Content if needed)
5. Invite bot to your server with appropriate permissions

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Your Discord bot token |
| `DISCORD_GUILD_ID` | No | Default server ID |
| `DISCORD_MCP_LEGACY` | No | Set `true` for legacy 93-tool mode |

### Required Bot Permissions

```
Manage Server
Manage Roles
Manage Channels
Manage Messages
View Channels
Send Messages
Connect (for voice)
Speak (for voice)
```

## Parameter Flexibility

The hybrid API supports intuitive parameter formats:

| Feature | Example |
|---------|---------|
| Numbers auto-convert to strings | `limit: 100` → `"100"` |
| Alias support | `limit` works as `count` |
| Both formats work | `content` or `message` for message text |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Desktop                            │
├─────────────────────────────────────────────────────────────┤
│  MCP Layer (~2,000 tokens)     │  Skill Layer (on-demand)   │
│  ┌─────────────────────────┐   │  ┌───────────────────────┐ │
│  │ discord_execute         │   │  │ SKILL.md (entry)      │ │
│  │ discord_query           │   │  │ workflows/*.md        │ │
│  │ discord_batch           │   │  │ reference/api.md      │ │
│  │ discord_help            │   │  └───────────────────────┘ │
│  └─────────────────────────┘   │                            │
├─────────────────────────────────────────────────────────────┤
│                   UnifiedExecutor                            │
│              (routes to 93 underlying operations)            │
├─────────────────────────────────────────────────────────────┤
│                   Discord.js Client                          │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `DISCORD_TOKEN is not set` | Add token to MCP config `env` block |
| High token usage | Ensure using `index-hybrid.js`, not `index.js` |
| Skill not loading | Run `./scripts/install-skill.sh` |
| Permission denied | Check bot permissions in Discord server |

### Getting Help

- Check [discord-skill/](discord-skill/) for detailed workflows
- See [docs/](docs/) for architecture documentation
- [Report issues](https://github.com/bouob/discord-mcp/issues)

## Credits

- **Original Project**: [sashathelambo/discord-mcp](https://github.com/sashathelambo/discord-mcp) by [@sashathelambo](https://github.com/sashathelambo) (Dr. Vova) - Creator of the comprehensive 93-tool Discord MCP server
- **Hybrid Architecture**: This fork adds MCP + Skill hybrid optimization for reduced token consumption
- [Discord.js](https://discord.js.org/) team for the excellent Discord API wrapper
- [Model Context Protocol](https://modelcontextprotocol.io/) community

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This software is provided "as-is" without warranty. Users are responsible for:

- Complying with Discord's Terms of Service
- Securing their bot tokens and credentials
- Using appropriate permissions and rate limiting
- Monitoring and maintaining their Discord bots
