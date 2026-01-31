import Database from 'better-sqlite3';
import { contentConfig } from './config';

let db: Database.Database;

export function getContentDb(): Database.Database {
  if (!db) {
    db = new Database(contentConfig.dbPath);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      category TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scraped_tweets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      text TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      retweets INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      quotes INTEGER DEFAULT 0,
      bookmarks INTEGER DEFAULT 0,
      created_at TEXT,
      scraped_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS context_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      raw_content TEXT,
      summary TEXT,
      last_scraped TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      digest_text TEXT NOT NULL,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS content_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'tweet',
      content TEXT NOT NULL,
      inspiration_tweet_id TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function closeContentDb() {
  if (db) {
    db.close();
  }
}
