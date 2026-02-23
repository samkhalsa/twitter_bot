import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'bot.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
    runMigrations();
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

    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      scheduled_at TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      posted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS search_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active',
      last_searched_at TEXT,
      last_cursor TEXT,
      hits INTEGER DEFAULT 0,
      replies_sent INTEGER DEFAULT 0,
      follow_backs INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tracked_communities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      community_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      member_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      last_polled_at TEXT,
      last_cursor TEXT,
      hits INTEGER DEFAULT 0,
      replies_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS replied_authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      tweet_id TEXT NOT NULL,
      reply_id INTEGER,
      follower_count INTEGER,
      source_query TEXT,
      followed_at TEXT,
      followed_back INTEGER DEFAULT 0,
      checked_follow_back_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, tweet_id)
    );
  `);
}

function runMigrations() {
  // Add new columns to pending_replies if they don't exist
  const columns = db.pragma('table_info(pending_replies)') as { name: string }[];
  const colNames = columns.map((c) => c.name);

  if (!colNames.includes('author_followers')) {
    db.exec('ALTER TABLE pending_replies ADD COLUMN author_followers INTEGER');
  }
  if (!colNames.includes('source_query')) {
    db.exec('ALTER TABLE pending_replies ADD COLUMN source_query TEXT');
  }
  if (!colNames.includes('source_type')) {
    db.exec("ALTER TABLE pending_replies ADD COLUMN source_type TEXT DEFAULT 'account'");
  }

  // Add feedback loop columns to replied_authors
  const raCols = db.pragma('table_info(replied_authors)') as { name: string }[];
  const raColNames = raCols.map((c) => c.name);

  if (!raColNames.includes('reply_tweet_id')) {
    db.exec('ALTER TABLE replied_authors ADD COLUMN reply_tweet_id TEXT');
  }
  if (!raColNames.includes('reply_likes')) {
    db.exec('ALTER TABLE replied_authors ADD COLUMN reply_likes INTEGER DEFAULT 0');
  }
  if (!raColNames.includes('reply_retweets')) {
    db.exec('ALTER TABLE replied_authors ADD COLUMN reply_retweets INTEGER DEFAULT 0');
  }
  if (!raColNames.includes('reply_views')) {
    db.exec('ALTER TABLE replied_authors ADD COLUMN reply_views INTEGER DEFAULT 0');
  }
  if (!raColNames.includes('reply_replies')) {
    db.exec('ALTER TABLE replied_authors ADD COLUMN reply_replies INTEGER DEFAULT 0');
  }
  if (!raColNames.includes('got_reply_back')) {
    db.exec('ALTER TABLE replied_authors ADD COLUMN got_reply_back INTEGER DEFAULT 0');
  }
}

export function getTodayEngagementCount(): number {
  const d = getDb();
  // SQLite stores created_at as 'YYYY-MM-DD HH:MM:SS' in UTC
  // Use SQLite's datetime to get midnight PT in UTC: subtract 8 hours from current UTC date
  // This gives us today's date in PT, then we convert midnight PT back to UTC
  const result = d.prepare(`
    SELECT COUNT(*) as count FROM replied_authors
    WHERE created_at >= datetime(date('now', '-8 hours'), '+8 hours')
  `).get() as { count: number };
  return result.count;
}

export function closeDb() {
  if (db) {
    db.close();
  }
}
