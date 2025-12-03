#!/bin/bash
# Discord MCP Skill 安裝腳本
# 將 Skill 複製到 Claude 的 skills 目錄

set -e

# 取得腳本所在目錄
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SKILL_SOURCE="$PROJECT_DIR/discord-skill"

# Claude skills 目錄
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"

echo "=== Discord MCP Skill 安裝程式 ==="
echo ""

# 檢查 skill 來源是否存在
if [ ! -d "$SKILL_SOURCE" ]; then
    echo "錯誤: 找不到 discord-skill 目錄: $SKILL_SOURCE"
    exit 1
fi

# 創建 Claude skills 目錄
if [ ! -d "$CLAUDE_SKILLS_DIR" ]; then
    echo "創建 Claude skills 目錄: $CLAUDE_SKILLS_DIR"
    mkdir -p "$CLAUDE_SKILLS_DIR"
fi

# 複製或更新 skill
SKILL_DEST="$CLAUDE_SKILLS_DIR/discord-skill"

if [ -d "$SKILL_DEST" ]; then
    echo "更新現有的 discord-skill..."
    rm -rf "$SKILL_DEST"
else
    echo "安裝 discord-skill..."
fi

cp -r "$SKILL_SOURCE" "$SKILL_DEST"

echo ""
echo "✅ Skill 安裝完成!"
echo ""
echo "安裝位置: $SKILL_DEST"
echo ""
echo "接下來請確認 MCP Server 設定:"
echo ""
echo "1. 編輯 ~/.claude/claude_desktop_config.json"
echo "2. 添加以下設定:"
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
echo "3. 重新啟動 Claude"
echo ""
