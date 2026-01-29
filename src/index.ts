import cron from 'node-cron';
import { config } from './config';
import { getDb, closeDb } from './db';
import { fetchUserTweets } from './services/twitter';
import { generateReply } from './services/ai';
import { sendTelegram, formatApprovalMessage, setupBotCommands } from './services/telegram';

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

      const insertResult = db.prepare(
        `INSERT OR IGNORE INTO pending_replies (tweet_id, tweet_text, tweet_author, tweet_url, generated_reply, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(tweet.id, tweet.text, tweet.author, tweet.url, reply, status);

      if (insertResult.changes === 0) continue;

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

export function getLastPollTime() {
  return lastPollTime;
}

// --- Setup Telegram Bot ---
setupBotCommands();
console.log('[Bot] Telegram bot started.');

// Schedule polling
const cronExpr = `*/${config.pollIntervalMinutes} * * * *`;
let cronTask: cron.ScheduledTask | null = cron.schedule(cronExpr, () => {
  pollAccounts().catch((err) =>
    console.error('[Poll] Unhandled error:', err)
  );
});
let pollingEnabled = true;
console.log(
  `[Bot] Polling every ${config.pollIntervalMinutes} minute(s).`
);

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
