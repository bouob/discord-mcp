#!/bin/bash
# Discord MCP Skill Installation Script
# Copies the Skill to Claude's skills directory

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SKILL_SOURCE="$PROJECT_DIR/discord-skill"

# Claude skills directory
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"

echo "=== Discord MCP Skill Installer ==="
echo ""

# Check if skill source exists
if [ ! -d "$SKILL_SOURCE" ]; then
    echo "Error: discord-skill directory not found: $SKILL_SOURCE"
    exit 1
fi

# Create Claude skills directory
if [ ! -d "$CLAUDE_SKILLS_DIR" ]; then
    echo "Creating Claude skills directory: $CLAUDE_SKILLS_DIR"
    mkdir -p "$CLAUDE_SKILLS_DIR"
fi

# Copy or update skill
SKILL_DEST="$CLAUDE_SKILLS_DIR/discord-skill"

if [ -d "$SKILL_DEST" ]; then
    echo "Updating existing discord-skill..."
    rm -rf "$SKILL_DEST"
else
    echo "Installing discord-skill..."
fi

cp -r "$SKILL_SOURCE" "$SKILL_DEST"

echo ""
echo "✅ Skill installation complete!"
echo ""
echo "Installation path: $SKILL_DEST"
echo ""
echo "Next, configure your MCP Server:"
echo ""
echo "1. Edit ~/.claude/claude_desktop_config.json"
echo "2. Add the following configuration:"
echo ""
cat << 'EOF'
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["$PROJECT_DIR/dist/index-hybrid.js"],
      "env": {
        "DISCORD_TOKEN": "your_bot_token_here",
        "DISCORD_GUILD_ID": "your_guild_id_here"
      }
    }
  }
}
EOF
echo ""
echo "3. Restart Claude"
echo ""
