# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update` | Pull upstream NanoClaw changes, merge with customizations, run migrations |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# Sprite VM (current)
sprite-env services start nanoclaw
sprite-env services stop nanoclaw
sprite-env services restart nanoclaw
sprite-env services get nanoclaw          # check status/PID

# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.

## Runbook: Agent Not Responding

**Symptom:** Messages sent to the bot go unanswered.

**Quick check:**
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}"
tail -20 logs/nanoclaw.log
```

**Most common cause:** A container is stuck. The agent container stays alive between turns waiting for follow-up messages, but occasionally hangs indefinitely (observed root cause unclear — the 30.5-min hard timeout in `container-runner.ts` failed to fire). While stuck, no new containers can spawn for that group.

**Fix:**
```bash
docker kill nanoclaw-main-<id>   # or nanoclaw-<group>-<id>
```
The slot frees immediately and the next message will spawn a fresh container.

**To diagnose further:** Check if `timedOut: false` appears in the container close log (`groups/main/logs/container-*.log`) — if so, the hard timeout never fired. A log entry "Container timeout, stopping gracefully" at the expected time (~30 min after last agent output) would confirm the timer is working.

**Sprite VM note:** NanoClaw runs as a Sprite service (`service.sh` wrapper) which auto-restarts on VM wake. The VM sleeps when idle — Telegram long-polling usually keeps it awake, but if nanoclaw dies, the service will restart it. Logs for the service itself are at `/.sprite/logs/services/nanoclaw.log`.
