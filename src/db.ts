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
  `);
}

export function closeDb() {
  if (db) {
    db.close();
  }
}
