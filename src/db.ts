import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { ChatConfig, Database, GlobalBanRecord, defaultChatConfig } from "./types";

// If DATABASE_URL is set (a Render Postgres instance, or any Postgres),
// everything is persisted there — this survives redeploys/restarts, unlike
// the web service's local disk. Without it, falls back to a local JSON file
// for convenience during local development only.
const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

const JSON_DB_PATH = path.join(__dirname, "..", "data", "db.json");

let cache: Database = { chats: {}, globalBans: {} };
const pendingWrites = new Set<string>();
let flushTimer: NodeJS.Timeout | null = null;

function ensureJsonFile(): void {
  const dir = path.dirname(JSON_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(JSON_DB_PATH)) {
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify({ chats: {}, globalBans: {} }, null, 2));
  }
}

// Call once at startup, before bot.launch(), to hydrate the in-memory cache.
export async function initDatabase(): Promise<void> {
  if (pool) {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS chat_configs (
        chat_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    const res = await pool.query("SELECT chat_id, data FROM chat_configs");
    for (const row of res.rows) {
      cache.chats[row.chat_id] = row.data as ChatConfig;
    }

    await pool.query(
      `CREATE TABLE IF NOT EXISTS global_bans (
        user_id TEXT PRIMARY KEY,
        reason TEXT NOT NULL DEFAULT '',
        banned_by TEXT NOT NULL DEFAULT '',
        banned_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    const gbanRes = await pool.query("SELECT user_id, reason, banned_by, banned_at FROM global_bans");
    for (const row of gbanRes.rows) {
      cache.globalBans[row.user_id] = {
        reason: row.reason,
        bannedBy: parseInt(row.banned_by, 10) || 0,
        bannedAt: row.banned_at instanceof Date ? row.banned_at.toISOString() : String(row.banned_at),
      };
    }

    console.log(
      `Connected to Postgres. Loaded ${res.rows.length} chat config(s) and ${gbanRes.rows.length} global ban(s).`
    );
  } else {
    ensureJsonFile();
    try {
      const raw = fs.readFileSync(JSON_DB_PATH, "utf-8");
      cache = JSON.parse(raw);
      if (!cache.globalBans) cache.globalBans = {};
    } catch {
      cache = { chats: {}, globalBans: {} };
    }
    console.log(
      "DATABASE_URL not set — using local JSON file storage. " +
        "This will NOT survive Render restarts/redeploys. Set DATABASE_URL to a Postgres " +
        "connection string (e.g. from a free Render Postgres instance) for durable storage."
    );
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flush().catch((err) => console.error("Flush error:", err));
  }, 250);
}

async function flush(): Promise<void> {
  const chatIds = Array.from(pendingWrites);
  pendingWrites.clear();

  if (pool) {
    for (const chatId of chatIds) {
      const data = cache.chats[chatId];
      if (!data) continue;
      try {
        await pool.query(
          `INSERT INTO chat_configs (chat_id, data, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (chat_id) DO UPDATE SET data = $2::jsonb, updated_at = now()`,
          [chatId, JSON.stringify(data)]
        );
      } catch (err) {
        console.error(`Failed to persist chat ${chatId} to Postgres:`, err);
      }
    }
  } else {
    try {
      fs.writeFileSync(JSON_DB_PATH, JSON.stringify(cache, null, 2));
    } catch (err) {
      console.error("Failed to write local JSON db:", err);
    }
  }
}

// Fills in any fields that didn't exist yet when a chat's record was first
// saved (e.g. an older bot version), so accessing a newly-added field on an
// old record never crashes with "Cannot read properties of undefined".
function withDefaults(stored: Partial<ChatConfig>): ChatConfig {
  const defaults = defaultChatConfig();
  return {
    ...defaults,
    ...stored,
    nightMode: { ...defaults.nightMode, ...(stored.nightMode || {}) },
  };
}

export function getChatConfig(chatId: number): ChatConfig {
  const key = String(chatId);
  if (!cache.chats[key]) {
    cache.chats[key] = defaultChatConfig();
    pendingWrites.add(key);
    scheduleFlush();
  } else {
    cache.chats[key] = withDefaults(cache.chats[key]);
  }
  return cache.chats[key];
}

export function saveChatConfig(chatId: number, config: ChatConfig): void {
  const key = String(chatId);
  cache.chats[key] = config;
  pendingWrites.add(key);
  scheduleFlush();
}

export function trackUser(chatId: number, userId: number): void {
  const config = getChatConfig(chatId);
  if (!config.knownUserIds.includes(userId)) {
    config.knownUserIds.push(userId);
    saveChatConfig(chatId, config);
  }
}

export function getAllChatConfigs(): Record<string, ChatConfig> {
  return cache.chats;
}

// Global bans are rare, deliberate admin actions (not per-message hot path),
// so these persist immediately instead of going through the debounced flush
// used for chat configs.
export function addGlobalBan(userId: number, reason: string, bannedBy: number): void {
  const key = String(userId);
  const record: GlobalBanRecord = { reason, bannedBy, bannedAt: new Date().toISOString() };
  cache.globalBans[key] = record;

  if (pool) {
    pool
      .query(
        `INSERT INTO global_bans (user_id, reason, banned_by, banned_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET reason = $2, banned_by = $3, banned_at = $4`,
        [key, reason, String(bannedBy), record.bannedAt]
      )
      .catch((err) => console.error(`Failed to persist global ban for ${key}:`, err));
  } else {
    try {
      fs.writeFileSync(JSON_DB_PATH, JSON.stringify(cache, null, 2));
    } catch (err) {
      console.error("Failed to write local JSON db:", err);
    }
  }
}

export function removeGlobalBan(userId: number): void {
  const key = String(userId);
  delete cache.globalBans[key];

  if (pool) {
    pool
      .query("DELETE FROM global_bans WHERE user_id = $1", [key])
      .catch((err) => console.error(`Failed to remove global ban for ${key}:`, err));
  } else {
    try {
      fs.writeFileSync(JSON_DB_PATH, JSON.stringify(cache, null, 2));
    } catch (err) {
      console.error("Failed to write local JSON db:", err);
    }
  }
}

export function isGloballyBanned(userId: number): boolean {
  return Boolean(cache.globalBans[String(userId)]);
}

export function getGlobalBans(): Record<string, GlobalBanRecord> {
  return cache.globalBans;
}
