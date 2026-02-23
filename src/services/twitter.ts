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

export interface SearchTweet extends Tweet {
  authorFollowers: number;
  sourceQuery: string;
  isReply: boolean;
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
 * Returns the new tweet ID on success, or null on failure.
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

    const newTweetId = response.data?.data?.id;
    if (newTweetId) {
      console.log(`[Twitter] Reply posted to tweet ${tweetId} (new tweet: ${newTweetId})`);
      return newTweetId;
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

/**
 * Post a standalone tweet via the official X API v2.
 */
export async function postTweet(text: string): Promise<boolean> {
  const url = 'https://api.x.com/2/tweets';
  const body = { text };

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

    if (response.data?.data?.id) {
      console.log(`[Twitter] Tweet posted (id: ${response.data.data.id})`);
      return true;
    }
    return false;
  } catch (error: any) {
    const status = error?.response?.status;
    console.error(
      `[Twitter] Error posting tweet:`,
      status || error.message,
      error?.response?.data ? JSON.stringify(error.response.data) : ''
    );
    return false;
  }
}

/**
 * Search tweets by keyword using /search-v3.
 * Returns tweets with author follower count inline.
 */
export async function searchTweets(
  query: string,
  options?: { minFollowers?: number; maxFollowers?: number; cursor?: string }
): Promise<{ tweets: SearchTweet[]; nextCursor?: string }> {
  const minFollowers = options?.minFollowers ?? 50;
  const maxFollowers = options?.maxFollowers ?? 200;

  try {
    const params: Record<string, string> = {
      type: 'Top',
      count: '20',
      query,
    };
    if (options?.cursor) {
      params.cursor = options.cursor;
    }

    const response = await api.get('/search-v3', { params });
    const data = response.data;

    const tweets: SearchTweet[] = [];
    const entries = extractSearchEntries(data);

    for (const entry of entries) {
      const parsed = parseSearchTweetEntry(entry, query);
      if (!parsed) continue;

      // Filter by follower count
      if (parsed.authorFollowers < minFollowers || parsed.authorFollowers > maxFollowers) continue;

      tweets.push(parsed);
    }

    // Extract pagination cursor
    const nextCursor = extractSearchCursor(data);

    return { tweets, nextCursor };
  } catch (error: any) {
    console.error(
      `[Twitter] Error searching for "${query}":`,
      error?.response?.status || error.message
    );
    return { tweets: [] };
  }
}

/**
 * Fetch the list of user IDs that a given user follows.
 * Used to check follow-backs.
 */
export async function fetchFollowingIds(username: string): Promise<string[]> {
  try {
    const userId = await resolveUserId(username);
    const response = await api.get('/following-ids', { params: { user: userId } });
    const ids = response.data?.result?.ids || response.data?.ids || [];
    return ids.map((id: any) => String(id));
  } catch (error: any) {
    console.error(
      `[Twitter] Error fetching following for @${username}:`,
      error?.response?.status || error.message
    );
    return [];
  }
}

/**
 * Fetch tweets from a community timeline using /community-tweets.
 * Returns tweets with author follower count, filtered by range.
 */
export async function fetchCommunityTweets(
  communityId: string,
  options?: { minFollowers?: number; maxFollowers?: number; cursor?: string }
): Promise<{ tweets: SearchTweet[]; nextCursor?: string }> {
  const minFollowers = options?.minFollowers ?? 50;
  const maxFollowers = options?.maxFollowers ?? 200;

  try {
    const params: Record<string, string> = {
      communityId,
      count: '20',
    };
    if (options?.cursor) {
      params.cursor = options.cursor;
    }

    const response = await api.get('/community-tweets', { params });
    const data = response.data;

    const tweets: SearchTweet[] = [];
    // Community tweets use result.timeline.instructions with standard format
    const instructions =
      data?.result?.timeline?.instructions || [];

    for (const instruction of instructions) {
      const entries = instruction?.entries || [];
      for (const entry of entries) {
        const entryId = entry?.entryId || '';
        if (!entryId.startsWith('tweet-')) continue;

        const parsed = parseCommunityTweetEntry(entry, `community:${communityId}`);
        if (!parsed) continue;

        // Filter by follower count
        if (parsed.authorFollowers < minFollowers || parsed.authorFollowers > maxFollowers) continue;

        tweets.push(parsed);
      }
    }

    // Extract cursor
    const topCursor = data?.cursor?.bottom;
    let nextCursor = topCursor;
    if (!nextCursor) {
      for (const instruction of instructions) {
        for (const entry of (instruction?.entries || [])) {
          if (entry?.entryId?.startsWith('cursor-bottom')) {
            nextCursor = entry?.content?.value || entry?.content?.itemContent?.value;
          }
        }
      }
    }

    return { tweets, nextCursor };
  } catch (error: any) {
    console.error(
      `[Twitter] Error fetching community ${communityId}:`,
      error?.response?.status || error.message
    );
    return { tweets: [] };
  }
}

function parseCommunityTweetEntry(entry: any, sourceQuery: string): SearchTweet | null {
  try {
    // Community tweets use itemContent path (not double content like search-v3)
    const tweetResult =
      entry?.content?.itemContent?.tweet_results?.result ||
      entry?.content?.content?.tweet_results?.result ||
      entry;

    const actualTweet = tweetResult?.tweet || tweetResult;

    const legacy = actualTweet?.legacy || actualTweet;
    const core = actualTweet?.core?.user_results?.result;
    // Community tweets use legacy path for user data
    const userLegacy = core?.legacy;
    const userCore = core?.core;

    const id =
      legacy?.id_str ||
      actualTweet?.rest_id ||
      entry?.entryId?.replace('tweet-', '');

    const text =
      legacy?.full_text || legacy?.text || actualTweet?.text ||
      actualTweet?.note_tweet?.note_tweet_results?.result?.text;

    if (!id || !text) return null;
    if (text.startsWith('RT @')) return null;

    const author =
      userLegacy?.screen_name || userCore?.screen_name || 'unknown';

    const followerCount =
      userLegacy?.followers_count ??
      core?.relationship_counts?.followers ??
      -1;

    if (followerCount < 0) return null;

    const isReply = !!(legacy?.in_reply_to_status_id_str || legacy?.in_reply_to_screen_name);

    return {
      id,
      text,
      author,
      url: `https://x.com/${author}/status/${id}`,
      createdAt: legacy?.created_at || new Date().toISOString(),
      authorFollowers: followerCount,
      sourceQuery,
      isReply,
    };
  } catch {
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

// --- Search-specific helpers ---

function extractSearchEntries(data: any): any[] {
  try {
    // /search-v3 nests under result.timeline_response.timeline.instructions
    const instructions =
      data?.result?.timeline_response?.timeline?.instructions ||
      data?.result?.timeline?.instructions ||
      data?.timeline?.instructions ||
      data?.result?.timeline_v2?.timeline?.instructions ||
      data?.instructions ||
      [];

    for (const instruction of instructions) {
      if (instruction.type === 'TimelineAddEntries' || instruction.__typename === 'TimelineAddEntries' || instruction.entries) {
        return instruction.entries || [];
      }
    }

    // Fallback: check if entries are at top level
    if (data?.result?.entries) return data.result.entries;
    if (Array.isArray(data)) return data;

    return [];
  } catch {
    return [];
  }
}

function parseSearchTweetEntry(entry: any, sourceQuery: string): SearchTweet | null {
  try {
    // search-v3 nests tweet content under content.content.tweet_results.result
    const tweetResult =
      entry?.content?.content?.tweet_results?.result ||
      entry?.content?.itemContent?.tweet_results?.result ||
      entry?.tweet ||
      entry;

    // Handle tweets with __typename "TweetWithVisibilityResults"
    const actualTweet = tweetResult?.tweet || tweetResult;

    const legacy = actualTweet?.legacy || actualTweet;
    const core = actualTweet?.core?.user_results?.result;
    // search-v3 puts screen_name under core.core, not core.legacy
    const userCore = core?.core;
    const userLegacy = core?.legacy;

    const id =
      legacy?.id_str ||
      actualTweet?.rest_id ||
      entry?.sortIndex ||
      entry?.entry_id?.replace('tweet-', '');

    const text =
      legacy?.full_text || legacy?.text || actualTweet?.text ||
      actualTweet?.note_tweet?.note_tweet_results?.result?.text;

    if (!id || !text) return null;

    // Skip retweets
    if (text.startsWith('RT @')) return null;

    const author =
      userCore?.screen_name || userLegacy?.screen_name || legacy?.screen_name || 'unknown';

    // Extract follower count — the key data point
    // search-v3 puts it at relationship_counts.followers
    const followerCount =
      core?.relationship_counts?.followers ??
      userLegacy?.followers_count ??
      core?.legacy?.followers_count ??
      -1;

    if (followerCount < 0) return null; // Can't determine follower count, skip

    // Detect if tweet is a reply
    const isReply = !!(legacy?.in_reply_to_status_id_str || legacy?.in_reply_to_screen_name);

    return {
      id,
      text,
      author,
      url: `https://x.com/${author}/status/${id}`,
      createdAt: legacy?.created_at || new Date().toISOString(),
      authorFollowers: followerCount,
      sourceQuery,
      isReply,
    };
  } catch {
    return null;
  }
}

export interface TweetEngagement {
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  bookmarks: number;
}

/**
 * Fetch engagement metrics for a specific tweet using /tweet?pid=TWEET_ID.
 * Returns the full thread — we find Kam's reply by its tweet ID and extract metrics.
 * Also checks if the original author replied back to Kam's reply (got_reply_back).
 */
export async function fetchTweetEngagement(
  originalTweetId: string,
  replyTweetId: string,
  originalAuthor: string
): Promise<{ engagement: TweetEngagement | null; gotReplyBack: boolean }> {
  try {
    const response = await api.get('/tweet', { params: { pid: originalTweetId } });
    const data = response.data;

    // /tweet returns data at data.data.threaded_conversation_with_injections_v2.instructions
    const instructions =
      data?.data?.threaded_conversation_with_injections_v2?.instructions ||
      data?.result?.timeline?.instructions ||
      [];

    let engagement: TweetEngagement | null = null;
    let gotReplyBack = false;

    for (const instruction of instructions) {
      const entries = instruction?.entries || [];
      for (const entry of entries) {
        // Thread entries have content.items array (conversationthread-*)
        // Single entries have content.itemContent directly
        const items = entry?.content?.items || [];

        const toCheck = items.length > 0
          ? items.map((item: any) => item?.item?.itemContent?.tweet_results?.result)
          : [entry?.content?.itemContent?.tweet_results?.result];

        for (const tweetResult of toCheck) {
          if (!tweetResult) continue;

          const actualTweet = tweetResult?.tweet || tweetResult;
          const legacy = actualTweet?.legacy || {};
          const tweetId = legacy?.id_str || actualTweet?.rest_id;

          // Found Kam's reply — extract engagement
          if (tweetId === replyTweetId) {
            engagement = {
              likes: legacy?.favorite_count ?? 0,
              retweets: legacy?.retweet_count ?? 0,
              replies: legacy?.reply_count ?? 0,
              views: parseInt(actualTweet?.views?.count || '0', 10),
              bookmarks: legacy?.bookmark_count ?? 0,
            };
          }

          // Check if original author replied back to Kam's reply
          const replyAuthor =
            actualTweet?.core?.user_results?.result?.legacy?.screen_name ||
            actualTweet?.core?.user_results?.result?.core?.screen_name;
          const replyTo = legacy?.in_reply_to_status_id_str;

          if (
            replyAuthor?.toLowerCase() === originalAuthor.toLowerCase() &&
            replyTo === replyTweetId
          ) {
            gotReplyBack = true;
          }
        }
      }
    }

    return { engagement, gotReplyBack };
  } catch (error: any) {
    console.error(
      `[Twitter] Error fetching engagement for tweet ${originalTweetId}:`,
      error?.response?.status || error.message
    );
    return { engagement: null, gotReplyBack: false };
  }
}

/**
 * Fetch Kam's follower list using /followers?user=UID.
 * Returns a Set of usernames (lowercase) who follow Kam.
 */
export async function fetchFollowerUsernames(kamUsername: string): Promise<Set<string>> {
  try {
    const userId = await resolveUserId(kamUsername);
    const response = await api.get('/followers', { params: { user: userId, count: '200' } });
    const data = response.data;

    const followers = new Set<string>();

    // Parse followers from timeline entries
    const instructions =
      data?.result?.timeline?.instructions ||
      data?.result?.timeline_v2?.timeline?.instructions ||
      [];

    for (const instruction of instructions) {
      const entries = instruction?.entries || [];
      for (const entry of entries) {
        const userResult =
          entry?.content?.itemContent?.user_results?.result ||
          null;
        if (!userResult) continue;

        const screenName =
          userResult?.legacy?.screen_name ||
          userResult?.core?.screen_name;
        if (screenName) {
          followers.add(screenName.toLowerCase());
        }
      }
    }

    // Also try flat array format
    if (followers.size === 0 && Array.isArray(data?.result?.users)) {
      for (const user of data.result.users) {
        const screenName = user?.legacy?.screen_name || user?.screen_name;
        if (screenName) followers.add(screenName.toLowerCase());
      }
    }

    return followers;
  } catch (error: any) {
    console.error(
      `[Twitter] Error fetching followers for @${kamUsername}:`,
      error?.response?.status || error.message
    );
    return new Set();
  }
}

function extractSearchCursor(data: any): string | undefined {
  try {
    // Also check top-level cursor object from search-v3
    const topCursor = data?.cursor?.bottom;
    if (topCursor) return topCursor;

    const instructions =
      data?.result?.timeline_response?.timeline?.instructions ||
      data?.result?.timeline?.instructions ||
      data?.timeline?.instructions ||
      data?.result?.timeline_v2?.timeline?.instructions ||
      data?.instructions ||
      [];

    for (const instruction of instructions) {
      const entries = instruction.entries || [];
      for (const entry of entries) {
        // Cursor entries have entryId starting with "cursor-bottom"
        if (entry?.entryId?.startsWith('cursor-bottom')) {
          return (
            entry?.content?.value ||
            entry?.content?.itemContent?.value ||
            undefined
          );
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
