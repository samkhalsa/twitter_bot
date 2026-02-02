import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'bot.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      last_tweet_id TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pending_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id TEXT UNIQUE NOT NULL,
      tweet_text TEXT NOT NULL,
      tweet_author TEXT NOT NULL,
      tweet_url TEXT,
      generated_reply TEXT NOT NULL,
      final_reply TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS bip_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bip_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_number INTEGER NOT NULL,
      answers TEXT NOT NULL,
      generated_post TEXT NOT NULL,
      final_post TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      posted_at TEXT
    );

    INSERT OR IGNORE INTO bip_config (key, value) VALUES ('day_number', '186');
    INSERT OR IGNORE INTO bip_config (key, value) VALUES ('product_desc', 'helping students learn better');
    INSERT OR IGNORE INTO bip_config (key, value) VALUES ('account', 'penseum_');
  `);
}

export function closeDb() {
  if (db) {
    db.close();
  }
}
