import axios from 'axios';
import { contentConfig } from '../config';
import { getContentDb } from '../db';

export interface ScrapedTweet {
  id: string;
  text: string;
  username: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  quotes: number;
  bookmarks: number;
  createdAt: string;
}

const api = axios.create({
  baseURL: `https://${contentConfig.rapidapi.host}`,
  headers: {
    'X-RapidAPI-Key': contentConfig.rapidapi.key,
    'X-RapidAPI-Host': contentConfig.rapidapi.host,
  },
});

const userIdCache = new Map<string, string>();

async function resolveUserId(username: string): Promise<string> {
  const cached = userIdCache.get(username.toLowerCase());
  if (cached) return cached;

  const response = await api.get('/user', { params: { username } });
  const userId = response.data?.result?.data?.user?.result?.rest_id;
  if (!userId) throw new Error(`Could not resolve user ID for @${username}`);

  userIdCache.set(username.toLowerCase(), userId);
  return userId;
}

export async function scrapeUserTweets(username: string): Promise<ScrapedTweet[]> {
  try {
    const userId = await resolveUserId(username);
    const response = await api.get('/user-tweets', { params: { user: userId } });

    const entries = extractEntries(response.data);
    const tweets: ScrapedTweet[] = [];

    for (const entry of entries) {
      const tweet = parseTweetWithMetrics(entry, username);
      if (tweet) tweets.push(tweet);
    }

    return tweets;
  } catch (error: any) {
    console.error(
      `[Scraper] Error fetching tweets for @${username}:`,
      error?.response?.status || error.message
    );
    return [];
  }
}

export async function scrapeAndStoreAll(): Promise<{ accounts: number; newTweets: number }> {
  const db = getContentDb();
  const accounts = db
    .prepare('SELECT username, category FROM content_accounts')
    .all() as { username: string; category: string | null }[];

  let newTweets = 0;

  for (const account of accounts) {
    console.log(`[Scraper] Scraping @${account.username}...`);
    const tweets = await scrapeUserTweets(account.username);

    const insert = db.prepare(
      `INSERT OR IGNORE INTO scraped_tweets (tweet_id, username, text, likes, retweets, replies, views, quotes, bookmarks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const tweet of tweets) {
      const result = insert.run(
        tweet.id, tweet.username, tweet.text,
        tweet.likes, tweet.retweets, tweet.replies,
        tweet.views, tweet.quotes, tweet.bookmarks,
        tweet.createdAt
      );
      if (result.changes > 0) newTweets++;
    }

    // Rate limit between accounts
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { accounts: accounts.length, newTweets };
}

export function getTopTweets(days: number = 7, limit: number = 10) {
  const db = getContentDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  return db.prepare(`
    SELECT *, (likes + retweets * 2 + replies * 3 + quotes) as score
    FROM scraped_tweets
    WHERE created_at > ?
    ORDER BY score DESC
    LIMIT ?
  `).all(since, limit) as (ScrapedTweet & { score: number })[];
}

// --- Response parsing ---

function extractEntries(data: any): any[] {
  try {
    const instructions =
      data?.result?.timeline_v2?.timeline?.instructions ||
      data?.result?.timeline?.timeline?.instructions ||
      data?.result?.timeline?.instructions ||
      data?.timeline?.instructions ||
      data?.instructions ||
      [];

    for (const instruction of instructions) {
      if (instruction.type === 'TimelineAddEntries' || instruction.entries) {
        return instruction.entries || [];
      }
    }

    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

function parseTweetWithMetrics(entry: any, fallbackAuthor: string): ScrapedTweet | null {
  try {
    const tweetResult =
      entry?.content?.itemContent?.tweet_results?.result ||
      entry?.content?.content?.tweetResult?.result ||
      entry?.tweet ||
      entry;

    const legacy = tweetResult?.legacy || tweetResult;
    const core = tweetResult?.core?.user_results?.result?.legacy;

    const id = legacy?.id_str || tweetResult?.rest_id || entry?.sortIndex;
    const text = legacy?.full_text || legacy?.text || tweetResult?.text;

    if (!id || !text) return null;
    if (text.startsWith('RT @')) return null;

    const username = core?.screen_name || legacy?.screen_name || fallbackAuthor;

    return {
      id,
      text,
      username,
      likes: legacy?.favorite_count || 0,
      retweets: legacy?.retweet_count || 0,
      replies: legacy?.reply_count || 0,
      views: parseInt(tweetResult?.views?.count || '0', 10),
      quotes: legacy?.quote_count || 0,
      bookmarks: legacy?.bookmark_count || 0,
      createdAt: legacy?.created_at || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
