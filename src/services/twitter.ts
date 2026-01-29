import axios from 'axios';
import crypto from 'crypto';
import OAuth from 'oauth-1.0a';
import { config } from '../config';
import { sendTelegram } from './telegram';

export interface Tweet {
  id: string;
  text: string;
  author: string;
  url: string;
  createdAt: string;
}

// RapidAPI client for reading tweets
const api = axios.create({
  baseURL: `https://${config.rapidapi.host}`,
  headers: {
    'X-RapidAPI-Key': config.rapidapi.key,
    'X-RapidAPI-Host': config.rapidapi.host,
  },
});

// OAuth 1.0a for official X API v2 (posting)
const oauth = new OAuth({
  consumer: {
    key: config.twitter.consumerKey,
    secret: config.twitter.consumerSecret,
  },
  signature_method: 'HMAC-SHA1',
  hash_function(baseString, key) {
    return crypto.createHmac('sha1', key).update(baseString).digest('base64');
  },
});

const token = {
  key: config.twitter.accessToken,
  secret: config.twitter.accessTokenSecret,
};

// Cache username -> user ID to avoid repeated lookups
const userIdCache = new Map<string, string>();

async function resolveUserId(username: string): Promise<string> {
  const cached = userIdCache.get(username.toLowerCase());
  if (cached) return cached;

  const response = await api.get('/user', { params: { username } });
  const userId =
    response.data?.result?.data?.user?.result?.rest_id;
  if (!userId) throw new Error(`Could not resolve user ID for @${username}`);

  userIdCache.set(username.toLowerCase(), userId);
  return userId;
}

/**
 * Fetch recent tweets for a given username.
 * Returns tweets newer than sinceId if provided.
 */
export async function fetchUserTweets(
  username: string,
  sinceId?: string,
  options?: { skipTimeFilter?: boolean }
): Promise<Tweet[]> {
  try {
    const userId = await resolveUserId(username);
    const response = await api.get('/user-tweets', {
      params: { user: userId },
    });

    const data = response.data;
    const tweets: Tweet[] = [];

    // The API returns a timeline structure — parse tweets from it
    const entries = extractEntries(data);

    for (const entry of entries) {
      const tweet = parseTweetEntry(entry, username);
      if (!tweet) continue;

      // Skip tweets older than or equal to sinceId
      if (sinceId && BigInt(tweet.id) <= BigInt(sinceId)) continue;

      // Skip tweets older than 1 hour (unless explicitly skipped)
      if (!options?.skipTimeFilter) {
        const tweetTime = new Date(tweet.createdAt).getTime();
        if (Date.now() - tweetTime > 60 * 60 * 1000) continue;
      }

      tweets.push(tweet);
    }

    // Sort oldest first so we process in chronological order
    tweets.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

    return tweets;
  } catch (error: any) {
    console.error(
      `[Twitter] Error fetching tweets for @${username}:`,
      error?.response?.status || error.message
    );
    return [];
  }
}

/**
 * Post a reply to a tweet via the official X API v2.
 */
export async function postReply(
  tweetId: string,
  replyText: string
): Promise<string | null> {
  const url = 'https://api.x.com/2/tweets';
  const body = {
    text: replyText,
    reply: { in_reply_to_tweet_id: tweetId },
  };

  try {
    const authHeader = oauth.toHeader(
      oauth.authorize({ url, method: 'POST' }, token)
    );

    const response = await axios.post(url, body, {
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
    });

    console.log(`[Twitter] Post response:`, JSON.stringify(response.data).slice(0, 500));

    if (response.data?.data?.id) {
      console.log(`[Twitter] Reply posted to tweet ${tweetId} (new tweet: ${response.data.data.id})`);
      return response.data.data.id;
    }
    return null;
  } catch (error: any) {
    const status = error?.response?.status;
    const responseData = error?.response?.data;
    console.error(
      `[Twitter] Error posting reply to ${tweetId}:`,
      status || error.message,
      responseData ? JSON.stringify(responseData) : ''
    );

    if (status === 401 || status === 403) {
      await sendTelegram(
        '⚠️ Twitter API auth failed. Check your OAuth credentials in .env.'
      );
    } else if (status === 429) {
      await sendTelegram(
        '⚠️ Twitter rate limit hit (17 tweets/24h on free tier). Try again later.'
      );
    } else {
      await sendTelegram(
        `⚠️ Twitter post failed (${status || error.message}).`
      );
    }

    return null;
  }
}

// --- Helpers to parse the twitter241 API response ---

function extractEntries(data: any): any[] {
  try {
    // twitter241 returns data in Twitter's GraphQL timeline format
    // Navigate the nested structure to find tweet entries
    const instructions =
      data?.result?.timeline_v2?.timeline?.instructions ||
      data?.result?.timeline?.timeline?.instructions ||
      data?.result?.timeline?.instructions ||
      data?.timeline?.instructions ||
      data?.instructions ||
      [];

    for (const instruction of instructions) {
      if (
        instruction.type === 'TimelineAddEntries' ||
        instruction.entries
      ) {
        return instruction.entries || [];
      }
    }

    // Fallback: if data is an array of tweets directly
    if (Array.isArray(data)) return data;

    return [];
  } catch {
    return [];
  }
}

function parseTweetEntry(entry: any, fallbackAuthor: string): Tweet | null {
  try {
    // Navigate nested tweet result structure
    const tweetResult =
      entry?.content?.itemContent?.tweet_results?.result ||
      entry?.content?.content?.tweetResult?.result ||
      entry?.tweet ||
      entry;

    const legacy = tweetResult?.legacy || tweetResult;
    const core = tweetResult?.core?.user_results?.result?.legacy;

    const id =
      legacy?.id_str ||
      tweetResult?.rest_id ||
      entry?.sortIndex ||
      entry?.entryId?.replace('tweet-', '');

    const text =
      legacy?.full_text || legacy?.text || tweetResult?.text;

    if (!id || !text) return null;

    // Skip retweets — we only want original tweets
    if (text.startsWith('RT @')) return null;

    const author =
      core?.screen_name || legacy?.screen_name || fallbackAuthor;

    return {
      id,
      text,
      author,
      url: `https://x.com/${author}/status/${id}`,
      createdAt: legacy?.created_at || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
