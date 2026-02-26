import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(import.meta.dirname, '..', 'store', 'messages.db');
const db = new Database(dbPath);

const chatJid = process.argv[2] || 'tg:5026821928';
const message = process.argv[3] || 'test message';
const now = new Date().toISOString();
const id = `inject-${Date.now()}`;

db.prepare(
  `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
).run(id, chatJid, chatJid, 'Jon', message, now, 0, 0);

db.prepare(
  `INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(jid) DO UPDATE SET last_message_time = excluded.last_message_time`
).run(chatJid, "Jon's Brain", now, 'telegram', 0);

console.log(`Injected message: "${message}" at ${now} (id: ${id})`);
db.close();
