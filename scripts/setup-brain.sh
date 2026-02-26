#!/bin/bash
# Setup for Jon's Brain remote assistant via NanoClaw + Telegram
#
# Works on both local Mac and remote Sprite VM.
# Set BRAIN_REPO_PATH to override brain repo location.
#
# Prerequisites:
#   1. Docker running
#   2. ANTHROPIC_API_KEY in .env
#   3. Telegram bot token from @BotFather
#
# Usage:
#   ./scripts/setup-brain.sh                          # local (~/src/mylife/brain)
#   BRAIN_REPO_PATH=~/brain ./scripts/setup-brain.sh  # remote

set -e
cd "$(dirname "$0")/.."

BRAIN_REPO="${BRAIN_REPO_PATH:-$HOME/src/mylife/brain}"

echo "=== NanoClaw Brain Setup ==="
echo "Brain repo: $BRAIN_REPO"
echo ""

# Check Docker
if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not running. Start Docker Desktop first."
  exit 1
fi

# Check brain repo
if [ ! -d "$BRAIN_REPO/context" ]; then
  echo "ERROR: Brain repo not found at $BRAIN_REPO"
  echo "Clone it: git clone https://github.com/jhshapi/brain.git $BRAIN_REPO"
  exit 1
fi

# Check .env
if ! grep -q "ANTHROPIC_API_KEY=sk-" .env 2>/dev/null; then
  echo "ERROR: ANTHROPIC_API_KEY not set in .env"
  exit 1
fi

if ! grep -q "TELEGRAM_BOT_TOKEN=." .env 2>/dev/null; then
  echo ""
  echo "No TELEGRAM_BOT_TOKEN set."
  echo ""
  echo "To get one:"
  echo "  1. Open Telegram and message @BotFather"
  echo "  2. Send /newbot"
  echo "  3. Choose a name (e.g., 'Jon Brain')"
  echo "  4. Choose a username (e.g., 'jon_brain_bot')"
  echo "  5. Copy the token"
  echo ""
  read -p "Paste your bot token: " token
  if [ -z "$token" ]; then
    echo "No token provided. Exiting."
    exit 1
  fi
  sed -i '' "s/^TELEGRAM_BOT_TOKEN=.*/TELEGRAM_BOT_TOKEN=$token/" .env 2>/dev/null || \
  sed -i "s/^TELEGRAM_BOT_TOKEN=.*/TELEGRAM_BOT_TOKEN=$token/" .env
  echo "Token saved to .env"
fi

# Build Docker image if needed
if ! docker image inspect nanoclaw-agent:latest > /dev/null 2>&1; then
  echo ""
  echo "Building agent Docker image (this takes a few minutes on first run)..."
  docker build -t nanoclaw-agent:latest ./container
fi

# Install host deps
echo ""
echo "Installing host dependencies..."
npm install --silent

# Build host
echo "Building host..."
npm run build --silent

# Create mount allowlist
ALLOWLIST_DIR="$HOME/.config/nanoclaw"
ALLOWLIST="$ALLOWLIST_DIR/mount-allowlist.json"
echo ""
echo "Writing mount allowlist to $ALLOWLIST"
mkdir -p "$ALLOWLIST_DIR"
cat > "$ALLOWLIST" << EOF
{
  "allowedRoots": [
    {
      "path": "$BRAIN_REPO/context",
      "allowReadWrite": true,
      "description": "Brain context files (people, orgs, interactions, tasks, projects)"
    },
    {
      "path": "$BRAIN_REPO/.claude",
      "allowReadWrite": false,
      "description": "Brain agent config (tools, agents, config) - read-only"
    },
    {
      "path": "$BRAIN_REPO/specs",
      "allowReadWrite": false,
      "description": "Brain specs and plans - read-only"
    },
    {
      "path": "~/.google_workspace_mcp/credentials/personal",
      "allowReadWrite": true,
      "description": "Google OAuth credentials (shapiro.jon@gmail.com) - writable for token refresh"
    },
    {
      "path": "~/.google_workspace_mcp/credentials/imxp",
      "allowReadWrite": true,
      "description": "Google OAuth credentials (jon@im-xp.com) - writable for token refresh"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": false
}
EOF

# Create Google credentials directories
mkdir -p "$HOME/.google_workspace_mcp/credentials/personal"
mkdir -p "$HOME/.google_workspace_mcp/credentials/imxp"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Start NanoClaw:  npm run dev"
echo "  2. Send /chatid to your bot in Telegram"
echo "  3. Register:  BRAIN_REPO_PATH=$BRAIN_REPO npx tsx scripts/register-brain.ts tg:YOUR_CHAT_ID"
echo "  4. Copy Google OAuth credentials if deploying remotely:"
echo "     scp ~/.google_workspace_mcp/credentials/personal/*.json remote:~/.google_workspace_mcp/credentials/personal/"
echo "     scp ~/.google_workspace_mcp/credentials/imxp/*.json remote:~/.google_workspace_mcp/credentials/imxp/"
echo "  5. Send a message to your bot!"
echo ""
