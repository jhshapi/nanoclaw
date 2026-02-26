/**
 * Register the brain group for a Telegram DM.
 *
 * Usage:
 *   1. Start NanoClaw with TELEGRAM_BOT_TOKEN set
 *   2. Send /chatid to your bot in Telegram
 *   3. Run: npx tsx scripts/register-brain.ts tg:YOUR_CHAT_ID
 *
 * This registers your Telegram DM as the "brain" group with:
 *   - No trigger required (all messages processed)
 *   - Brain repo context/ mounted read-write
 *   - Brain repo .claude/ and specs/ mounted read-only
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const chatJid = process.argv[2];
// Brain repo path: defaults to ~/src/mylife/brain (local), override with BRAIN_REPO_PATH env var
const BRAIN_REPO = process.env.BRAIN_REPO_PATH || '~/src/mylife/brain';

if (!chatJid || !chatJid.startsWith('tg:')) {
  console.error('Usage: npx tsx scripts/register-brain.ts tg:YOUR_CHAT_ID');
  console.error('');
  console.error('Get your chat ID by sending /chatid to your bot in Telegram.');
  console.error('Set BRAIN_REPO_PATH env var to override brain repo location (default: ~/src/mylife/brain)');
  process.exit(1);
}

const storeDir = path.resolve(import.meta.dirname, '..', 'store');
fs.mkdirSync(storeDir, { recursive: true });
const dbPath = path.join(storeDir, 'messages.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS registered_groups (
    jid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL UNIQUE,
    trigger_pattern TEXT NOT NULL,
    added_at TEXT NOT NULL,
    container_config TEXT,
    requires_trigger INTEGER DEFAULT 1
  );
`);

const containerConfig = {
  additionalMounts: [
    {
      hostPath: `${BRAIN_REPO}/context`,
      containerPath: 'context',
      readonly: false,
    },
    {
      hostPath: `${BRAIN_REPO}/.claude/config`,
      containerPath: 'claude-config/config',
      readonly: true,
    },
    {
      hostPath: `${BRAIN_REPO}/.claude/tools`,
      containerPath: 'claude-config/tools',
      readonly: true,
    },
    {
      hostPath: `${BRAIN_REPO}/.claude/agents`,
      containerPath: 'claude-config/agents',
      readonly: true,
    },
    {
      hostPath: `${BRAIN_REPO}/specs`,
      containerPath: 'specs',
      readonly: true,
    },
    {
      hostPath: '~/.google_workspace_mcp/credentials/personal',
      containerPath: 'google-creds/personal',
      readonly: false,
    },
    {
      hostPath: '~/.google_workspace_mcp/credentials/imxp',
      containerPath: 'google-creds/imxp',
      readonly: false,
    },
  ],
  gitSync: {
    repoPath: BRAIN_REPO,
  },
};

db.prepare(`
  INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  chatJid,
  "Jon's Brain",
  'brain',
  '@Brain',
  new Date().toISOString(),
  JSON.stringify(containerConfig),
  0, // no trigger required - all messages processed
);

console.log(`Registered brain group for ${chatJid}`);
console.log('');
console.log('Container config:');
console.log(`  Brain repo: ${BRAIN_REPO}`);
console.log(`  Extra mount: ${BRAIN_REPO}/context → /workspace/extra/context (read-write)`);
console.log(`  Extra mount: ${BRAIN_REPO}/.claude/* → /workspace/extra/claude-config/* (read-only)`);
console.log(`  Extra mount: ${BRAIN_REPO}/specs → /workspace/extra/specs (read-only)`);
console.log(`  Git sync: enabled (pull before run, push after writes)`);
console.log(`  Trigger required: no`);
console.log('');
console.log('Now start NanoClaw and send a message to your bot!');

db.close();
