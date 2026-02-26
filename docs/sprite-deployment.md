# Deploying NanoClaw on Sprite (Fly.io)

Operational notes from deploying NanoClaw as a Telegram bot on a Sprite VM.

## Architecture

```
Sprite VM (brain-bot)
├── ~/nanoclaw/          NanoClaw host process (Node.js)
├── ~/brain/             Brain context repo (git clone, bind-mounted into containers)
└── Docker               Agent containers spawned per-group
```

The host process runs on the Sprite VM directly. Agent containers run in Docker inside the VM. The brain context repo is bind-mounted into containers at `/workspace/extra/context`.

## Initial Setup

```bash
sprite create brain-bot
sprite exec -s brain-bot -- bash -c '
  git clone https://github.com/jhshapi/nanoclaw.git ~/nanoclaw
  cd ~/nanoclaw
  npm install
  npm run build
'
```

### Docker Image

Build the agent container image inside the Sprite VM:

```bash
sprite exec -s brain-bot -- bash -c '
  cd ~/nanoclaw
  docker build -t nanoclaw-agent:latest -f container/Dockerfile container/
'
```

### Environment

Create `~/nanoclaw/.env` with:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ONLY=true
ASSISTANT_NAME=Brain
ANTHROPIC_API_KEY=...
TZ=America/Chicago
IDLE_TIMEOUT=86400000
```

**Critical**: `TZ` must be in `.env` because Sprite VMs default to UTC. NanoClaw's `config.ts` reads TZ from the `.env` whitelist and passes it to containers via `-e TZ=...`.

`IDLE_TIMEOUT=86400000` (24h) keeps warm containers alive. With container warmup on startup, follow-up messages route through IPC without cold start latency.

### Mount Allowlist

Create `~/.config/nanoclaw/mount-allowlist.json` with paths the container may access:

```json
{
  "allowedRoots": [
    "/home/sprite/brain/context",
    "/home/sprite/brain/.claude",
    "/home/sprite/brain/specs",
    "/home/sprite/.google_workspace_mcp"
  ],
  "blockedPatterns": ["*.env", "*.key", "*.pem"]
}
```

## Process Management

### Problem: Sprite VM Sleep

Sprites hibernate after 30 seconds of inactivity. **TTY sessions (sprite exec, nohup) do not survive hibernation.** Only Sprite services persist.

### Solution: Register as Sprite Service

```bash
sprite-env services create nanoclaw --cmd node --args dist/index.js
```

This runs NanoClaw as a managed service that automatically restarts when the VM wakes.

### Fallback: Manual nohup (Non-Persistent)

If `sprite-env services` isn't available, use nohup (process dies on VM sleep):

```bash
sprite exec -s brain-bot -- bash -c '
  cd ~/nanoclaw && nohup node dist/index.js > /tmp/nanoclaw.log 2>&1 &
'
```

To restart after VM wakes:

```bash
sprite exec -s brain-bot -- bash -c '
  cd ~/nanoclaw
  kill $(pgrep -f "node dist/index.js") 2>/dev/null
  sleep 1
  nohup node dist/index.js > /tmp/nanoclaw.log 2>&1 &
'
```

## Performance Tuning

### Cold Start Pipeline

Without optimization, cold start takes ~2 minutes:

| Phase | Time | Fix |
|-------|------|-----|
| Docker spawn | 5s | N/A |
| `npx tsc` recompilation | 30-45s | Pre-compile in Dockerfile |
| npx MCP package download | 15-25s | Pre-install in Dockerfile |
| CLI version check | 1-2s | `CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK=1` |
| Claude API init | 10-30s | N/A (irreducible) |

After optimization: ~15 seconds cold start.

### Pre-installed MCP Packages

In `container/Dockerfile`:
```dockerfile
RUN npm install -g agent-browser @anthropic-ai/claude-code slack-mcp-server @suekou/mcp-notion-server
```

Then in agent-runner, use global binary names instead of npx:
```typescript
'slack-imxp': { command: 'slack-mcp-server', args: ['--transport', 'stdio'] }
'notion-query': { command: 'mcp-notion-server', args: [] }
```

### Container Warmup

NanoClaw warms containers on startup via `warmupGroups()` in `index.ts`. The warm container stays alive via IPC, so follow-up messages skip cold start entirely.

### Session Rotation

Sessions accumulate conversation history. A 244KB session causes 2.5 minutes of API think time before the first tool call.

The agent-runner checks transcript size after each query. If over 100KB, it clears the session so the next query starts fresh. The CLAUDE.md and system prompt carry forward all persistent context.

### Google Workspace Tool Tier

The workspace-mcp `--tool-tier` flag controls which tools are exposed:

| Tier | Calendar Tools |
|------|---------------|
| core | list_calendars, get_events, create_event, modify_event |
| extended | + delete_event, query_freebusy |

Use `--tool-tier extended` to enable event deletion.

## Deployment Workflow

After making changes locally:

```bash
cd ~/src/nanoclaw
git push fork main

# On Sprite:
sprite exec -s brain-bot -- bash -c 'cd ~/nanoclaw && git pull && npm run build'

# Restart (kill old, start new):
sprite exec -s brain-bot -- bash -c '
  PID=$(pgrep -f "node dist/index.js"); kill $PID 2>/dev/null
'
# Wait a moment, then:
sprite exec -s brain-bot -- bash -c '
  cd ~/nanoclaw && nohup node dist/index.js > /tmp/nanoclaw.log 2>&1 &
'
```

Note: `pkill -f` pattern-matches the sprite exec session itself. Use `pgrep` to get the PID first, then `kill` by PID.

If the Docker image changed (Dockerfile modifications), rebuild:
```bash
sprite exec -s brain-bot -- bash -c '
  cd ~/nanoclaw
  docker build -t nanoclaw-agent:latest -f container/Dockerfile container/
'
```

Agent-runner source changes don't require image rebuild (bind-mounted from host). However, the bind-mount points at `data/sessions/<group>/agent-runner-src/`, a copy made on first container creation. After updating `groups/<group>/agent-runner-src/`, either restart the host process (which re-syncs the copy) or manually copy:
```bash
sprite exec -s brain-bot -- bash -c '
  cp ~/nanoclaw/groups/brain/agent-runner-src/index.ts \
     ~/nanoclaw/data/sessions/brain/agent-runner-src/index.ts
'
```

## Monitoring

```bash
# Recent logs
sprite exec -s brain-bot -- bash -c 'tail -30 /tmp/nanoclaw.log'

# Check processes
sprite exec -s brain-bot -- bash -c 'ps -ef | grep node | grep -v grep'

# Check warm container
sprite exec -s brain-bot -- bash -c 'docker ps --format "{{.Names}} {{.Status}}"'

# Container logs
sprite exec -s brain-bot -- bash -c 'docker logs $(docker ps -q --filter name=nanoclaw) 2>&1 | tail -20'

# Session transcript size (>100KB triggers rotation)
sprite exec -s brain-bot -- bash -c '
  ls -lh ~/nanoclaw/data/sessions/brain/.claude/projects/-workspace-group/*.jsonl
'
```

## Billing

Sprite usage appears in the Fly.io dashboard under **Cost Explorer**. Pricing: $0.07/CPU-hour, $0.04375/GB-hour memory. No charges when the VM is asleep.

The Sprite VM is under the `shapiro-jon-gmail-com` org (Sprites-managed, not visible as a Fly.io app).

## Known Issues

1. **VM sleep kills nohup processes**: Register as Sprite service instead
2. **pkill kills sprite exec session**: Use `pgrep` + `kill` by PID
3. **TZ not read from .env without whitelist**: Must be in `readEnvFile` keys in `config.ts`
4. **Session bloat causes API latency**: Session rotation at 100KB mitigates this
5. **Orphan Docker containers after host kill**: `docker stop <name>` before restarting
6. **Stale agent-runner source copy**: `container-runner.ts` now re-syncs on every spawn, but if running an older host build, manually copy from `groups/` to `data/sessions/` after `git pull`
