import cron, { type ScheduledTask } from 'node-cron';
import express from 'express';
import path from 'path';
import { config } from './config';
import { getDb, closeDb } from './db';
import { fetchUserTweets, postTweet, searchTweets, fetchCommunityTweets, fetchTweetEngagement, fetchFollowerUsernames } from './services/twitter';
import type { SearchTweet } from './services/twitter';
import { generateReply, assistPost } from './services/ai';
import { sendTelegram, sendDigestMessage, formatApprovalMessage, setupBotCommands } from './services/telegram';

console.log('[Bot] Starting Twitter Reply Bot...');

const db = getDb();
console.log('[Bot] Database initialized.');

// --- Polling Logic ---

let lastPollTime: Date | null = null;

async function pollAccounts() {
  const accounts = db
    .prepare('SELECT id, username, last_tweet_id FROM tracked_accounts')
    .all() as { id: number; username: string; last_tweet_id: string | null }[];

  if (accounts.length === 0) {
    console.log('[Poll] No tracked accounts. Add some via Telegram.');
    return;
  }

  console.log(`[Poll] Checking ${accounts.length} accounts...`);

  for (const account of accounts) {
    const tweets = await fetchUserTweets(
      account.username,
      account.last_tweet_id || undefined
    );

    if (tweets.length === 0) continue;

    // Only process the latest tweet (last in sorted array)
    const latestTweets = [tweets[tweets.length - 1]];

    console.log(
      `[Poll] Found ${tweets.length} new tweet(s) from @${account.username}, processing latest only`
    );

    for (const tweet of latestTweets) {
      // Check for duplicate
      const existing = db
        .prepare('SELECT id FROM pending_replies WHERE tweet_id = ?')
        .get(tweet.id);
      if (existing) continue;

      // Generate AI reply
      let reply = '';
      let status = 'new';
      try {
        reply = await generateReply(tweet.text, tweet.author);
        status = 'pending'; // ready for Telegram approval
        console.log(`[AI] Generated reply for tweet ${tweet.id}`);
      } catch (err) {
        console.error(`[AI] Failed to generate reply for tweet ${tweet.id}:`, err);
      }

      db.prepare(
        `INSERT INTO pending_replies (tweet_id, tweet_text, tweet_author, tweet_url, generated_reply, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(tweet.id, tweet.text, tweet.author, tweet.url, reply, status);

      console.log(`[Poll] Queued tweet ${tweet.id} from @${tweet.author} (status: ${status})`);

      // Send Telegram approval notification if reply was generated
      if (status === 'pending') {
        const row = db
          .prepare('SELECT id FROM pending_replies WHERE tweet_id = ?')
          .get(tweet.id) as { id: number };
        const msg = formatApprovalMessage(tweet.author, tweet.text, reply, row.id, tweet.createdAt, tweet.url);
        await sendTelegram(msg);
      }
    }

    // Update last_tweet_id to the newest tweet
    const newestId = tweets[tweets.length - 1].id;
    db.prepare('UPDATE tracked_accounts SET last_tweet_id = ? WHERE id = ?').run(
      newestId,
      account.id
    );

    // Small delay between accounts to respect rate limits
    await sleep(1000);
  }

  lastPollTime = new Date();
  console.log(`[Poll] Done at ${lastPollTime.toISOString()}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Search-based Discovery ---

const SEARCH_INTERVAL_MINUTES = parseInt(process.env.SEARCH_INTERVAL_MINUTES || '30', 10);
const MIN_FOLLOWERS = parseInt(process.env.MIN_FOLLOWERS || '50', 10);
const MAX_FOLLOWERS = parseInt(process.env.MAX_FOLLOWERS || '1000', 10);
let lastSearchTime: Date | null = null;
let searchEnabled = true;

/**
 * Tweet quality filter — skip low-quality candidates before spending Gemini calls.
 * Keeps volume manageable and reply quality high.
 */
function passesTweetQualityFilter(tweet: SearchTweet): boolean {
  const text = tweet.text;

  // Skip replies — we want original tweets where the author is sharing something
  if (tweet.isReply) return false;

  // Skip very short tweets (< 30 chars) — not enough substance to reply to meaningfully
  if (text.length < 30) return false;

  // Skip tweets that are mostly links/URLs with little text
  const textWithoutUrls = text.replace(/https?:\/\/\S+/g, '').trim();
  if (textWithoutUrls.length < 20) return false;

  // Skip tweets that are just hashtag spam (more than 3 hashtags)
  const hashtagCount = (text.match(/#\w+/g) || []).length;
  if (hashtagCount > 3) return false;

  // Skip promotional/spam patterns
  const spamPatterns = [
    /\b(giveaway|airdrop|whitelist|presale|free money)\b/i,
    /🚀{3,}/, // multiple rocket emojis = spam
    /follow.*retweet.*like/i, // engagement bait
    /DM me for/i,
  ];
  for (const pattern of spamPatterns) {
    if (pattern.test(text)) return false;
  }

  // Skip tweets older than 24 hours — stale replies look weird
  if (tweet.createdAt) {
    const tweetAge = Date.now() - new Date(tweet.createdAt).getTime();
    if (tweetAge > 24 * 60 * 60 * 1000) return false;
  }

  return true;
}

interface CandidateTweet {
  tweet: SearchTweet;
  sourceQuery: string;
  sourceType: 'search' | 'community';
  sourceLabel: string; // for Telegram tag
}

async function pollSearches() {
  const queries = db
    .prepare("SELECT id, query, last_cursor FROM search_queries WHERE status = 'active'")
    .all() as { id: number; query: string; last_cursor: string | null }[];

  const communities = db
    .prepare("SELECT id, community_id, name FROM tracked_communities WHERE status = 'active'")
    .all() as { id: number; community_id: string; name: string }[];

  if (queries.length === 0 && communities.length === 0) {
    console.log('[Search] No active search queries or communities.');
    return;
  }

  console.log(`[Search] Phase 1: Pulling tweets from ${queries.length} queries + ${communities.length} communities (followers: ${MIN_FOLLOWERS}-${MAX_FOLLOWERS})...`);

  // --- PHASE 1: Pull all tweets (fast, no AI calls) ---
  const candidates: CandidateTweet[] = [];
  let totalFound = 0;
  let totalSkipped = 0;

  // Search queries
  for (const sq of queries) {
    try {
      const { tweets } = await searchTweets(sq.query, {
        minFollowers: MIN_FOLLOWERS,
        maxFollowers: MAX_FOLLOWERS,
        cursor: undefined,
      });

      console.log(`[Search] "${sq.query}" → ${tweets.length} tweets in follower range`);
      totalFound += tweets.length;

      for (const tweet of tweets) {
        const existing = db.prepare('SELECT id FROM pending_replies WHERE tweet_id = ?').get(tweet.id);
        if (existing) continue;
        if (tweet.author.toLowerCase() === 'kyushithe') continue;
        if (!passesTweetQualityFilter(tweet)) { totalSkipped++; continue; }

        candidates.push({ tweet, sourceQuery: sq.query, sourceType: 'search', sourceLabel: `🔍 "${sq.query}"` });
        db.prepare('UPDATE search_queries SET hits = hits + 1 WHERE id = ?').run(sq.id);
      }

      db.prepare('UPDATE search_queries SET last_searched_at = CURRENT_TIMESTAMP WHERE id = ?').run(sq.id);
      await sleep(1000);
    } catch (err) {
      console.error(`[Search] Error for query "${sq.query}":`, err);
    }
  }

  // Community tweets
  for (const community of communities) {
    try {
      const { tweets } = await fetchCommunityTweets(community.community_id, {
        minFollowers: MIN_FOLLOWERS,
        maxFollowers: MAX_FOLLOWERS,
      });

      console.log(`[Search] Community "${community.name}" → ${tweets.length} tweets in follower range`);
      totalFound += tweets.length;

      for (const tweet of tweets) {
        const existing = db.prepare('SELECT id FROM pending_replies WHERE tweet_id = ?').get(tweet.id);
        if (existing) continue;
        if (tweet.author.toLowerCase() === 'kyushithe') continue;
        if (!passesTweetQualityFilter(tweet)) { totalSkipped++; continue; }

        candidates.push({ tweet, sourceQuery: community.name, sourceType: 'community', sourceLabel: `🏘️ ${community.name}` });
        db.prepare('UPDATE tracked_communities SET hits = hits + 1 WHERE id = ?').run(community.id);
      }

      db.prepare('UPDATE tracked_communities SET last_polled_at = CURRENT_TIMESTAMP WHERE id = ?').run(community.id);
      await sleep(1000);
    } catch (err) {
      console.error(`[Search] Error for community "${community.name}":`, err);
    }
  }

  // Cap at 20 candidates per cycle
  const MAX_CANDIDATES = 20;
  if (candidates.length > MAX_CANDIDATES) {
    console.log(`[Search] Capping from ${candidates.length} to ${MAX_CANDIDATES} candidates.`);
    candidates.length = MAX_CANDIDATES;
  }

  console.log(`[Search] Phase 1 done: ${totalFound} found, ${totalSkipped} skipped, ${candidates.length} candidates to generate replies for.`);

  if (candidates.length === 0) {
    lastSearchTime = new Date();
    return;
  }

  // --- PHASE 2: Batch generate replies (all AI calls) ---
  console.log(`[Search] Phase 2: Generating ${candidates.length} replies...`);
  let totalQueued = 0;

  // Track all queued items for digest message
  const digestItems: { id: number; author: string; followers: number; tweetPreview: string; reply: string; sourceLabel: string; tweetUrl?: string }[] = [];

  // Process in parallel batches of 5 for speed
  const BATCH_SIZE = 5;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (c) => {
        const reply = await generateReply(c.tweet.text, c.tweet.author, undefined, c.tweet.authorFollowers);
        return { ...c, reply };
      })
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[Search] AI batch error:`, result.reason);
        continue;
      }

      const { tweet, sourceQuery, sourceType, sourceLabel, reply } = result.value;

      db.prepare(
        `INSERT INTO pending_replies (tweet_id, tweet_text, tweet_author, tweet_url, generated_reply, status, author_followers, source_query, source_type)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      ).run(tweet.id, tweet.text, tweet.author, tweet.url, reply, tweet.authorFollowers, sourceQuery, sourceType);

      totalQueued++;

      const row = db.prepare('SELECT id FROM pending_replies WHERE tweet_id = ?').get(tweet.id) as { id: number };
      digestItems.push({
        id: row.id,
        author: tweet.author,
        followers: tweet.authorFollowers,
        tweetPreview: tweet.text.length > 100 ? tweet.text.slice(0, 100) + '...' : tweet.text,
        reply,
        sourceLabel,
        tweetUrl: tweet.url,
      });

      console.log(`[Search] Reply ${totalQueued}/${candidates.length}: @${tweet.author} (${tweet.authorFollowers} followers)`);
    }
  }

  lastSearchTime = new Date();
  console.log(`[Search] Done at ${lastSearchTime.toISOString()} — found ${totalFound}, skipped ${totalSkipped}, queued ${totalQueued}`);

  // Send digest message instead of individual messages
  if (digestItems.length > 0) {
    await sendDigestMessage(digestItems);
  }
}

// --- Feedback Loop ---

const KAM_USERNAME = 'KyushiThe';
let lastFeedbackTime: Date | null = null;

interface RepliedAuthorRow {
  id: number;
  username: string;
  tweet_id: string;
  reply_tweet_id: string | null;
  follower_count: number | null;
  source_query: string | null;
  followed_back: number;
  checked_follow_back_at: string | null;
  reply_likes: number;
  reply_views: number;
  reply_replies: number;
  reply_retweets: number;
  got_reply_back: number;
  created_at: string;
}

/**
 * Feedback loop — runs alongside each search cycle.
 * 1. Fetch Kam's follower list once (to check follow-backs in batch).
 * 2. For each recent replied_author that hasn't been checked in 4+ hours:
 *    - Check engagement on Kam's reply (likes, views, reply-backs).
 *    - Check if the author followed back.
 * 3. Update the database.
 * 4. Send a Telegram summary if anything interesting happened.
 */
async function checkFeedback() {
  // Get replied authors from the last 7 days that haven't been checked recently (4h cooldown)
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const authors = db.prepare(`
    SELECT id, username, tweet_id, reply_tweet_id, follower_count, source_query,
           followed_back, checked_follow_back_at, reply_likes, reply_views,
           reply_replies, reply_retweets, got_reply_back, created_at
    FROM replied_authors
    WHERE created_at > ?
      AND (checked_follow_back_at IS NULL OR checked_follow_back_at < ?)
      AND reply_tweet_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 20
  `).all(weekAgo, cutoff) as RepliedAuthorRow[];

  if (authors.length === 0) {
    console.log('[Feedback] No authors to check (all recently checked or no reply_tweet_id).');
    lastFeedbackTime = new Date();
    return;
  }

  console.log(`[Feedback] Checking ${authors.length} replied authors...`);

  // Step 1: Fetch Kam's follower list once
  let kamFollowers: Set<string>;
  try {
    kamFollowers = await fetchFollowerUsernames(KAM_USERNAME);
    console.log(`[Feedback] Kam has ${kamFollowers.size} followers loaded.`);
  } catch (err) {
    console.error('[Feedback] Failed to fetch Kam followers:', err);
    kamFollowers = new Set();
  }

  await sleep(1000);

  // Step 2: Check each author
  const updates: { username: string; followedBack: boolean; gotReplyBack: boolean; likes: number; views: number }[] = [];
  let newFollowBacks = 0;
  let newReplyBacks = 0;

  for (const author of authors) {
    try {
      // Check follow-back from our follower list
      const followedBack = kamFollowers.has(author.username.toLowerCase());

      // Check engagement on Kam's reply
      const { engagement, gotReplyBack } = await fetchTweetEngagement(
        author.tweet_id,
        author.reply_tweet_id!,
        author.username
      );

      // Update database
      const updateStmt = db.prepare(`
        UPDATE replied_authors
        SET followed_back = ?,
            got_reply_back = ?,
            reply_likes = ?,
            reply_retweets = ?,
            reply_views = ?,
            reply_replies = ?,
            checked_follow_back_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      updateStmt.run(
        followedBack ? 1 : 0,
        gotReplyBack ? 1 : 0,
        engagement?.likes ?? author.reply_likes,
        engagement?.retweets ?? author.reply_retweets,
        engagement?.views ?? author.reply_views,
        engagement?.replies ?? author.reply_replies,
        author.id
      );

      // Track changes for summary
      if (followedBack && !author.followed_back) newFollowBacks++;
      if (gotReplyBack && !author.got_reply_back) newReplyBacks++;

      updates.push({
        username: author.username,
        followedBack,
        gotReplyBack,
        likes: engagement?.likes ?? 0,
        views: engagement?.views ?? 0,
      });

      // Also update search_queries/tracked_communities follow_backs counter
      if (followedBack && !author.followed_back && author.source_query) {
        db.prepare('UPDATE search_queries SET follow_backs = follow_backs + 1 WHERE query = ?').run(author.source_query);
      }

      console.log(`[Feedback] @${author.username}: follow=${followedBack}, reply_back=${gotReplyBack}, likes=${engagement?.likes ?? '?'}, views=${engagement?.views ?? '?'}`);

      await sleep(1500); // Rate limit between API calls
    } catch (err) {
      console.error(`[Feedback] Error checking @${author.username}:`, err);
      // Still mark as checked to avoid infinite retries
      db.prepare('UPDATE replied_authors SET checked_follow_back_at = CURRENT_TIMESTAMP WHERE id = ?').run(author.id);
    }
  }

  lastFeedbackTime = new Date();
  console.log(`[Feedback] Done at ${lastFeedbackTime.toISOString()} — checked ${authors.length}, new follow-backs: ${newFollowBacks}, new reply-backs: ${newReplyBacks}`);

  // Step 3: Send Telegram summary if anything notable happened
  if (newFollowBacks > 0 || newReplyBacks > 0) {
    const lines: string[] = ['📊 *Feedback Loop Update*', ''];

    if (newFollowBacks > 0) {
      const followedBackAuthors = updates.filter(u => u.followedBack);
      lines.push(`✅ *${newFollowBacks} new follow-back(s):*`);
      for (const u of followedBackAuthors) {
        if (authors.find(a => a.username === u.username && !a.followed_back)) {
          lines.push(`  • @${u.username}`);
        }
      }
      lines.push('');
    }

    if (newReplyBacks > 0) {
      lines.push(`💬 *${newReplyBacks} new reply-back(s):*`);
      for (const u of updates) {
        if (u.gotReplyBack && authors.find(a => a.username === u.username && !a.got_reply_back)) {
          lines.push(`  • @${u.username}`);
        }
      }
      lines.push('');
    }

    // Top performing replies by views
    const topByViews = updates.filter(u => u.views > 0).sort((a, b) => b.views - a.views).slice(0, 3);
    if (topByViews.length > 0) {
      lines.push('👀 *Top replies by views:*');
      for (const u of topByViews) {
        lines.push(`  • @${u.username}: ${u.views} views, ${u.likes} likes`);
      }
    }

    await sendTelegram(lines.join('\n'));
  }
}

export function getLastFeedbackTime() {
  return lastFeedbackTime;
}

export function getLastSearchTime() {
  return lastSearchTime;
}

export function isSearchEnabled() {
  return searchEnabled;
}

export function startSearch() {
  if (searchEnabled) return false;
  if (searchCronTask) searchCronTask.start();
  searchEnabled = true;
  console.log('[Bot] Search polling started.');
  return true;
}

export function stopSearch() {
  if (!searchEnabled) return false;
  if (searchCronTask) searchCronTask.stop();
  searchEnabled = false;
  console.log('[Bot] Search polling stopped.');
  return true;
}

export function triggerSearch() {
  return pollSearches();
}

export function triggerFeedback() {
  return checkFeedback();
}

export function getLastPollTime() {
  return lastPollTime;
}

// --- Setup Telegram Bot ---
setupBotCommands();
console.log('[Bot] Telegram bot started.');

// Schedule polling
const cronExpr = `*/${config.pollIntervalMinutes} * * * *`;
let cronTask: ScheduledTask | null = cron.schedule(cronExpr, () => {
  pollAccounts().catch((err) =>
    console.error('[Poll] Unhandled error:', err)
  );
});
let pollingEnabled = true;
console.log(
  `[Bot] Polling every ${config.pollIntervalMinutes} minute(s).`
);

// Schedule search polling (separate from account polling)
const searchCronExpr = `*/${SEARCH_INTERVAL_MINUTES} * * * *`;
let searchCronTask: ScheduledTask | null = cron.schedule(searchCronExpr, async () => {
  if (searchEnabled) {
    await pollSearches().catch((err) => console.error('[Search] Unhandled error:', err));
  }
  // Run feedback loop after search (regardless of searchEnabled — feedback is always useful)
  await checkFeedback().catch((err) => console.error('[Feedback] Unhandled error:', err));
});
console.log(`[Bot] Search polling every ${SEARCH_INTERVAL_MINUTES} minute(s).`);

export function isPollingEnabled() {
  return pollingEnabled;
}

export function startPolling() {
  if (pollingEnabled) return false;
  if (!cronTask) {
    cronTask = cron.schedule(cronExpr, () => {
      pollAccounts().catch((err) =>
        console.error('[Poll] Unhandled error:', err)
      );
    });
  } else {
    cronTask.start();
  }
  pollingEnabled = true;
  console.log('[Bot] Polling started.');
  return true;
}

export function stopPolling() {
  if (!pollingEnabled) return false;
  if (cronTask) {
    cronTask.stop();
  }
  pollingEnabled = false;
  console.log('[Bot] Polling stopped.');
  return true;
}

export function triggerPoll() {
  return pollAccounts();
}

// Run once on startup
pollAccounts().catch((err) => console.error('[Poll] Startup poll error:', err));

// --- Express API Server ---
const app = express();
app.use(express.json());

// Simple auth with environment variable password
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';
const AUTH_SECRET = process.env.AUTH_SECRET || 'twitter-bot-secret-key';

function generateToken(): string {
  return Buffer.from(`${Date.now()}-${AUTH_SECRET}`).toString('base64');
}

function verifyToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    return decoded.includes(AUTH_SECRET);
  } catch {
    return false;
  }
}

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === AUTH_PASSWORD) {
    const token = generateToken();
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');
  if (token && verifyToken(token)) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Get all posts
app.get('/api/posts', (req, res) => {
  const posts = db.prepare(`
    SELECT id, content, tags, scheduled_at as scheduledAt, status, created_at as createdAt, posted_at as postedAt
    FROM scheduled_posts
    ORDER BY created_at DESC
  `).all();

  const parsed = posts.map((p: any) => ({
    ...p,
    tags: JSON.parse(p.tags || '[]'),
  }));

  res.json(parsed);
});

// Create a post
app.post('/api/posts', (req, res) => {
  const { content, tags, scheduledAt, status } = req.body;

  const result = db.prepare(`
    INSERT INTO scheduled_posts (content, tags, scheduled_at, status)
    VALUES (?, ?, ?, ?)
  `).run(content, JSON.stringify(tags || []), scheduledAt || null, status || 'draft');

  const post = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(result.lastInsertRowid) as any;
  res.json({
    ...post,
    tags: JSON.parse(post?.tags || '[]'),
  });
});

// Update a post
app.put('/api/posts/:id', (req, res) => {
  const { content, tags, scheduledAt, status } = req.body;

  db.prepare(`
    UPDATE scheduled_posts
    SET content = ?, tags = ?, scheduled_at = ?, status = ?
    WHERE id = ?
  `).run(content, JSON.stringify(tags || []), scheduledAt || null, status || 'draft', req.params.id);

  const post = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(req.params.id) as any;
  res.json({
    ...post,
    tags: JSON.parse(post?.tags || '[]'),
  });
});

// Delete a post
app.delete('/api/posts/:id', (req, res) => {
  db.prepare('DELETE FROM scheduled_posts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Post immediately
app.post('/api/posts/now', async (req, res) => {
  const { content, tags } = req.body;

  try {
    const success = await postTweet(content);
    if (success) {
      db.prepare(`
        INSERT INTO scheduled_posts (content, tags, status, posted_at)
        VALUES (?, ?, 'posted', datetime('now'))
      `).run(content, JSON.stringify(tags || []));
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Failed to post tweet' });
    }
  } catch (error) {
    console.error('[API] Post now error:', error);
    res.status(500).json({ success: false, error: 'Failed to post tweet' });
  }
});

// AI assist endpoint
app.post('/api/ai/assist', async (req, res) => {
  const { content, mode, tags } = req.body;

  try {
    const result = await assistPost(content, mode, tags);
    res.json({ result });
  } catch (error) {
    console.error('[API] AI assist error:', error);
    res.status(500).json({ error: 'AI assist failed' });
  }
});

// --- Tracked Accounts API ---

// Get all tracked accounts
app.get('/api/accounts', (req, res) => {
  const accounts = db.prepare(`
    SELECT id, username, last_tweet_id as lastTweetId, added_at as addedAt
    FROM tracked_accounts
    ORDER BY username ASC
  `).all();
  res.json(accounts);
});

// Add a new tracked account
app.post('/api/accounts', (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  // Clean username (remove @ if present)
  const cleanUsername = username.replace(/^@/, '').trim();

  if (!cleanUsername) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  // Check if already exists
  const existing = db.prepare('SELECT id FROM tracked_accounts WHERE LOWER(username) = LOWER(?)').get(cleanUsername);
  if (existing) {
    return res.status(409).json({ error: 'Account already tracked' });
  }

  try {
    const result = db.prepare('INSERT INTO tracked_accounts (username) VALUES (?)').run(cleanUsername);
    const account = db.prepare('SELECT id, username, last_tweet_id as lastTweetId, added_at as addedAt FROM tracked_accounts WHERE id = ?').get(result.lastInsertRowid);
    console.log(`[API] Added tracked account: @${cleanUsername}`);
    res.json(account);
  } catch (error) {
    console.error('[API] Error adding account:', error);
    res.status(500).json({ error: 'Failed to add account' });
  }
});

// Delete a tracked account
app.delete('/api/accounts/:id', (req, res) => {
  const account = db.prepare('SELECT username FROM tracked_accounts WHERE id = ?').get(req.params.id) as { username: string } | undefined;

  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  db.prepare('DELETE FROM tracked_accounts WHERE id = ?').run(req.params.id);
  console.log(`[API] Removed tracked account: @${account.username}`);
  res.json({ success: true });
});

// --- Bot Status API ---

// Get bot status
app.get('/api/status', (req, res) => {
  const accountCount = (db.prepare('SELECT COUNT(*) as count FROM tracked_accounts').get() as { count: number }).count;
  const pendingCount = (db.prepare("SELECT COUNT(*) as count FROM pending_replies WHERE status = 'pending'").get() as { count: number }).count;
  const postedCount = (db.prepare("SELECT COUNT(*) as count FROM pending_replies WHERE status = 'posted'").get() as { count: number }).count;

  const searchQueryCount = (db.prepare("SELECT COUNT(*) as count FROM search_queries WHERE status = 'active'").get() as { count: number }).count;
  const searchRepliesCount = (db.prepare("SELECT COUNT(*) as count FROM pending_replies WHERE source_type = 'search' AND status IN ('posted', 'edited')").get() as { count: number }).count;
  const communityCount = (db.prepare("SELECT COUNT(*) as count FROM tracked_communities WHERE status = 'active'").get() as { count: number }).count;
  const communityRepliesCount = (db.prepare("SELECT COUNT(*) as count FROM pending_replies WHERE source_type = 'community' AND status IN ('posted', 'edited')").get() as { count: number }).count;

  const followBackCount = (db.prepare("SELECT COUNT(*) as count FROM replied_authors WHERE followed_back = 1").get() as { count: number }).count;
  const replyBackCount = (db.prepare("SELECT COUNT(*) as count FROM replied_authors WHERE got_reply_back = 1").get() as { count: number }).count;
  const totalRepliedAuthors = (db.prepare("SELECT COUNT(*) as count FROM replied_authors").get() as { count: number }).count;

  res.json({
    pollingEnabled,
    pollIntervalMinutes: config.pollIntervalMinutes,
    lastPollTime: lastPollTime ? lastPollTime.toISOString() : null,
    accountCount,
    pendingReplies: pendingCount,
    postedReplies: postedCount,
    searchEnabled,
    searchIntervalMinutes: SEARCH_INTERVAL_MINUTES,
    lastSearchTime: lastSearchTime ? lastSearchTime.toISOString() : null,
    searchQueryCount,
    searchRepliesPosted: searchRepliesCount,
    communityCount,
    communityRepliesPosted: communityRepliesCount,
    followerRange: { min: MIN_FOLLOWERS, max: MAX_FOLLOWERS },
    feedback: {
      lastFeedbackTime: lastFeedbackTime ? lastFeedbackTime.toISOString() : null,
      totalRepliedAuthors,
      followBacks: followBackCount,
      replyBacks: replyBackCount,
    },
  });
});

// Trigger a poll manually
app.post('/api/poll', async (req, res) => {
  try {
    await pollAccounts();
    res.json({ success: true, lastPollTime: lastPollTime?.toISOString() });
  } catch (error) {
    console.error('[API] Poll error:', error);
    res.status(500).json({ error: 'Poll failed' });
  }
});

// --- Search Queries API ---

app.get('/api/searches', (req, res) => {
  const queries = db.prepare(`
    SELECT id, query, status, last_searched_at as lastSearchedAt, hits, replies_sent as repliesSent, follow_backs as followBacks, created_at as createdAt
    FROM search_queries ORDER BY created_at DESC
  `).all();
  res.json(queries);
});

app.post('/api/searches', (req, res) => {
  const { query } = req.body;
  if (!query?.trim()) {
    return res.status(400).json({ error: 'Query is required' });
  }

  const existing = db.prepare('SELECT id FROM search_queries WHERE query = ?').get(query.trim());
  if (existing) {
    return res.status(409).json({ error: 'Query already exists' });
  }

  try {
    const result = db.prepare('INSERT INTO search_queries (query) VALUES (?)').run(query.trim());
    const search = db.prepare('SELECT id, query, status, hits, replies_sent as repliesSent, follow_backs as followBacks, created_at as createdAt FROM search_queries WHERE id = ?').get(result.lastInsertRowid);
    console.log(`[API] Added search query: "${query.trim()}"`);
    res.json(search);
  } catch (error) {
    console.error('[API] Error adding search query:', error);
    res.status(500).json({ error: 'Failed to add search query' });
  }
});

app.put('/api/searches/:id', (req, res) => {
  const { status } = req.body;
  if (!['active', 'paused'].includes(status)) {
    return res.status(400).json({ error: 'Status must be active or paused' });
  }
  db.prepare('UPDATE search_queries SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

app.delete('/api/searches/:id', (req, res) => {
  const search = db.prepare('SELECT query FROM search_queries WHERE id = ?').get(req.params.id) as { query: string } | undefined;
  if (!search) {
    return res.status(404).json({ error: 'Search query not found' });
  }
  db.prepare('DELETE FROM search_queries WHERE id = ?').run(req.params.id);
  console.log(`[API] Removed search query: "${search.query}"`);
  res.json({ success: true });
});

// Trigger search manually
app.post('/api/search/run', async (req, res) => {
  try {
    await pollSearches();
    res.json({ success: true, lastSearchTime: lastSearchTime?.toISOString() });
  } catch (error) {
    console.error('[API] Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Trigger feedback check manually
app.post('/api/feedback/run', async (req, res) => {
  try {
    await checkFeedback();
    res.json({ success: true, lastFeedbackTime: lastFeedbackTime?.toISOString() });
  } catch (error) {
    console.error('[API] Feedback error:', error);
    res.status(500).json({ error: 'Feedback check failed' });
  }
});

// Start/stop search polling
app.post('/api/search/start', (req, res) => {
  const started = startSearch();
  res.json({ success: started, searchEnabled });
});

app.post('/api/search/stop', (req, res) => {
  const stopped = stopSearch();
  res.json({ success: stopped, searchEnabled });
});

// --- Communities API ---

app.get('/api/communities', (req, res) => {
  const communities = db.prepare(`
    SELECT id, community_id as communityId, name, member_count as memberCount, status,
           last_polled_at as lastPolledAt, hits, replies_sent as repliesSent, created_at as createdAt
    FROM tracked_communities ORDER BY created_at DESC
  `).all();
  res.json(communities);
});

app.post('/api/communities', (req, res) => {
  const { communityId, name, memberCount } = req.body;
  if (!communityId || !name) {
    return res.status(400).json({ error: 'communityId and name are required' });
  }

  const existing = db.prepare('SELECT id FROM tracked_communities WHERE community_id = ?').get(communityId);
  if (existing) {
    return res.status(409).json({ error: 'Community already tracked' });
  }

  try {
    const result = db.prepare('INSERT INTO tracked_communities (community_id, name, member_count) VALUES (?, ?, ?)').run(communityId, name, memberCount || 0);
    const community = db.prepare('SELECT id, community_id as communityId, name, member_count as memberCount, status, hits, replies_sent as repliesSent, created_at as createdAt FROM tracked_communities WHERE id = ?').get(result.lastInsertRowid);
    console.log(`[API] Added community: "${name}" (${communityId})`);
    res.json(community);
  } catch (error) {
    console.error('[API] Error adding community:', error);
    res.status(500).json({ error: 'Failed to add community' });
  }
});

app.put('/api/communities/:id', (req, res) => {
  const { status } = req.body;
  if (!['active', 'paused'].includes(status)) {
    return res.status(400).json({ error: 'Status must be active or paused' });
  }
  db.prepare('UPDATE tracked_communities SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

app.delete('/api/communities/:id', (req, res) => {
  const community = db.prepare('SELECT name FROM tracked_communities WHERE id = ?').get(req.params.id) as { name: string } | undefined;
  if (!community) {
    return res.status(404).json({ error: 'Community not found' });
  }
  db.prepare('DELETE FROM tracked_communities WHERE id = ?').run(req.params.id);
  console.log(`[API] Removed community: "${community.name}"`);
  res.json({ success: true });
});

// --- Replied Authors / Follow Tracking API ---

app.get('/api/follows', (req, res) => {
  const authors = db.prepare(`
    SELECT ra.id, ra.username, ra.follower_count as followerCount, ra.source_query as sourceQuery,
           ra.followed_at as followedAt, ra.followed_back as followedBack,
           ra.checked_follow_back_at as checkedFollowBackAt, ra.created_at as createdAt,
           COUNT(ra2.id) as totalReplies
    FROM replied_authors ra
    LEFT JOIN replied_authors ra2 ON ra2.username = ra.username
    GROUP BY ra.username
    ORDER BY ra.created_at DESC
    LIMIT 200
  `).all();
  res.json(authors);
});

app.post('/api/follows/:id/mark-followed', (req, res) => {
  db.prepare('UPDATE replied_authors SET followed_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/follows/batch-follow', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const stmt = db.prepare('UPDATE replied_authors SET followed_at = CURRENT_TIMESTAMP WHERE id = ?');
  for (const id of ids) {
    stmt.run(id);
  }
  res.json({ success: true, count: ids.length });
});

// Start/stop polling
app.post('/api/polling/start', (req, res) => {
  const started = startPolling();
  res.json({ success: started, pollingEnabled });
});

app.post('/api/polling/stop', (req, res) => {
  const stopped = stopPolling();
  res.json({ success: stopped, pollingEnabled });
});

// Serve frontend static files
const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendPath));

// SPA fallback - serve index.html for non-API routes
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendPath, 'index.html'));
  } else {
    next();
  }
});

// Start Express server
app.listen(config.port, () => {
  console.log(`[API] Server running on port ${config.port}`);
  console.log(`[Frontend] Serving from ${frontendPath}`);
});

// Check for scheduled posts every minute
cron.schedule('* * * * *', async () => {
  const now = new Date().toISOString();
  const duePosts = db.prepare(`
    SELECT * FROM scheduled_posts
    WHERE status = 'scheduled' AND scheduled_at <= ?
  `).all(now) as any[];

  for (const post of duePosts) {
    try {
      const success = await postTweet(post.content);
      if (success) {
        db.prepare(`
          UPDATE scheduled_posts SET status = 'posted', posted_at = datetime('now') WHERE id = ?
        `).run(post.id);
        console.log(`[Scheduler] Posted scheduled post #${post.id}`);
      }
    } catch (error) {
      console.error(`[Scheduler] Failed to post #${post.id}:`, error);
    }
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Bot] Shutting down...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Bot] Shutting down...');
  closeDb();
  process.exit(0);
});
