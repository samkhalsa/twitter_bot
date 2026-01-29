import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { getDb } from '../db';
import { postReply, fetchUserTweets } from './twitter';
import { generateReply } from './ai';

const bot = new TelegramBot(config.telegram.botToken, { polling: true });
const CHAT_ID = config.telegram.chatId;

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export async function sendTelegram(message: string): Promise<boolean> {
  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    return true;
  } catch (err) {
    // Fallback: retry without Markdown if parsing fails
    try {
      const plain = message.replace(/[*_`\[]/g, '');
      await bot.sendMessage(CHAT_ID, plain);
      return true;
    } catch (retryErr) {
      const errMsg = retryErr instanceof Error ? retryErr.message : 'Unknown error';
      console.error('[Telegram] Failed to send message:', errMsg);
      return false;
    }
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatApprovalMessage(
  tweetAuthor: string,
  tweetText: string,
  generatedReply: string,
  pendingId: number,
  createdAt?: string
): string {
  const postedAgo = createdAt ? ` (${timeAgo(createdAt)})` : '';
  return [
    `🐦 New tweet from @${escapeMarkdown(tweetAuthor)}${postedAgo}:`,
    `"${escapeMarkdown(tweetText)}"`,
    ``,
    `💬 Suggested reply:`,
    `"${escapeMarkdown(generatedReply)}"`,
    ``,
    `[ID: ${pendingId}]`,
    `Reply with:`,
    `• 1 — Approve & post`,
    `• 2 — Reject`,
    `• Or send your edited reply text`,
  ].join('\n');
}

interface PendingReply {
  id: number;
  tweet_id: string;
  tweet_text: string;
  tweet_author: string;
  generated_reply: string;
  status: string;
}

function getIndexExports() {
  // imported lazily to avoid circular deps
  try {
    return require('../index');
  } catch {
    return null;
  }
}

function getLastPollTime(): Date | null {
  return getIndexExports()?.getLastPollTime() ?? null;
}

export function setupBotCommands() {
  const db = getDb();

  // Debug: log all incoming messages
  bot.on('message', (msg) => {
    console.log(`[Telegram] Received: "${msg.text}" from chat ${msg.chat.id}`);
  });

  bot.onText(/^\/help(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const helpText = [
      `📖 *Commands:*`,
      ``,
      `*Polling Control*`,
      `• /start — start automatic polling`,
      `• /stop — stop automatic polling`,
      `• /poll — run a one-off poll now`,
      ``,
      `*Account Management*`,
      `• /add username — track a new account`,
      `• /remove username — stop tracking`,
      `• /list — show all tracked accounts`,
      `• /status — show bot stats`,
      `• /fetch username — fetch latest tweet & generate reply`,
      ``,
      `*Reply Approval*`,
      `• 1 — approve latest pending reply`,
      `• 1 #ID — approve specific reply`,
      `• 2 — reject latest pending reply`,
      `• 2 #ID — reject specific reply`,
      `• #ID your text — post custom reply`,
      ``,
      `*Regenerate*`,
      `• /regen — regenerate latest reply`,
      `• /regen #ID — regenerate specific reply`,
      `• /regen make it funnier — regen with instructions`,
      `• /regen #ID be more sarcastic — regen specific with instructions`,
    ];
    await sendTelegram(helpText.join('\n'));
  });

  bot.onText(/^\/start(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const idx = getIndexExports();
    if (!idx) { await sendTelegram('❌ Bot not ready.'); return; }
    if (idx.startPolling()) {
      await sendTelegram('▶️ Polling started.');
    } else {
      await sendTelegram('⚠️ Polling is already running.');
    }
  });

  bot.onText(/^\/stop(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const idx = getIndexExports();
    if (!idx) { await sendTelegram('❌ Bot not ready.'); return; }
    if (idx.stopPolling()) {
      await sendTelegram('⏸ Polling stopped.');
    } else {
      await sendTelegram('⚠️ Polling is already stopped.');
    }
  });

  bot.onText(/^\/poll(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const idx = getIndexExports();
    if (!idx) { await sendTelegram('❌ Bot not ready.'); return; }
    await sendTelegram('🔄 Running poll now...');
    try {
      await idx.triggerPoll();
      await sendTelegram('✅ Poll complete.');
    } catch (err) {
      console.error('[Poll] Manual poll error:', err);
      await sendTelegram('❌ Poll failed.');
    }
  });

  bot.onText(/^\/add(?:@\S+)?\s+@?(\S+)\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const username = match![1];
    try {
      db.prepare('INSERT INTO tracked_accounts (username) VALUES (?)').run(username);
      await sendTelegram(`✅ Now tracking @${username}`);
    } catch {
      await sendTelegram(`⚠️ @${username} is already being tracked.`);
    }
  });

  bot.onText(/^\/remove(?:@\S+)?\s+@?(\S+)\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const username = match![1];
    const result = db.prepare('DELETE FROM tracked_accounts WHERE username = ?').run(username);
    if (result.changes > 0) {
      await sendTelegram(`✅ Stopped tracking @${username}`);
    } else {
      await sendTelegram(`⚠️ @${username} was not being tracked.`);
    }
  });

  bot.onText(/^\/list(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const accounts = db
      .prepare('SELECT username FROM tracked_accounts ORDER BY added_at')
      .all() as { username: string }[];
    if (accounts.length === 0) {
      await sendTelegram('No tracked accounts. Send /add username to start.');
    } else {
      const list = accounts.map((a) => `• @${a.username}`).join('\n');
      await sendTelegram(`📋 Tracked accounts:\n${list}`);
    }
  });

  bot.onText(/^\/fetch(?:@\S+)?\s+@?(\S+)\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const username = match![1];
    console.log(`[Fetch] Command matched. Username: "${username}"`);

    try {
      await sendTelegram(`🔍 Fetching latest tweet from @${username}...`);
      const tweets = await fetchUserTweets(username, undefined, { skipTimeFilter: true });
      console.log(`[Fetch] Got ${tweets.length} tweets for @${username}`);

      if (tweets.length === 0) {
        await sendTelegram(`No recent tweets found for @${username}.`);
        return;
      }

      const latest = tweets[tweets.length - 1];

      const existing = db
        .prepare('SELECT id FROM pending_replies WHERE tweet_id = ?')
        .get(latest.id) as { id: number } | undefined;

      if (existing) {
        await sendTelegram(`Already have a pending reply for this tweet [#${existing.id}].`);
        return;
      }

      const reply = await generateReply(latest.text, latest.author);

      const result = db
        .prepare(
          `INSERT INTO pending_replies (tweet_id, tweet_text, tweet_author, tweet_url, generated_reply, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`
        )
        .run(latest.id, latest.text, latest.author, latest.url, reply);

      const pendingId = result.lastInsertRowid as number;
      const approvalMsg = formatApprovalMessage(latest.author, latest.text, reply, pendingId, latest.createdAt);
      await sendTelegram(approvalMsg);
    } catch (err) {
      console.error('[Fetch] Failed:', err);
      await sendTelegram(`❌ Failed to fetch tweets for @${username}.`);
    }
  });

  bot.onText(/^\/status(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const accounts = db
      .prepare('SELECT COUNT(*) as count FROM tracked_accounts')
      .get() as { count: number };
    const pendingCount = db
      .prepare("SELECT COUNT(*) as count FROM pending_replies WHERE status = 'pending'")
      .get() as { count: number };
    const postedCount = db
      .prepare("SELECT COUNT(*) as count FROM pending_replies WHERE status IN ('posted', 'edited')")
      .get() as { count: number };
    const lastPoll = getLastPollTime();
    const idx = getIndexExports();
    const pollingState = idx?.isPollingEnabled() ? '▶️ running' : '⏸ stopped';
    const lines = [
      `📊 *Bot Status:*`,
      `• Polling: ${pollingState}`,
      `• Tracked accounts: ${accounts.count}`,
      `• Pending replies: ${pendingCount.count}`,
      `• Posted replies: ${postedCount.count}`,
      `• Last poll: ${lastPoll ? lastPoll.toISOString() : 'never'}`,
    ];
    await sendTelegram(lines.join('\n'));
  });

  bot.onText(/^\/regen(?:@\S+)?(.*)$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const args = (match![1] || '').trim();
    const regenIdMatch = args.match(/#?(\d+)/);
    const instructions = args.replace(/#?\d+\s*/, '').trim() || undefined;
    let regenRow: { id: number; tweet_text: string; tweet_author: string } | undefined;

    if (regenIdMatch) {
      regenRow = db
        .prepare('SELECT id, tweet_text, tweet_author FROM pending_replies WHERE id = ? AND status = ?')
        .get(parseInt(regenIdMatch[1], 10), 'pending') as typeof regenRow;
    } else {
      regenRow = db
        .prepare('SELECT id, tweet_text, tweet_author FROM pending_replies WHERE status = ? ORDER BY created_at DESC LIMIT 1')
        .get('pending') as typeof regenRow;
    }

    if (!regenRow) {
      await sendTelegram('No pending reply to regenerate.');
      return;
    }

    try {
      const newReply = await generateReply(regenRow.tweet_text, regenRow.tweet_author, instructions);
      db.prepare('UPDATE pending_replies SET generated_reply = ? WHERE id = ?').run(newReply, regenRow.id);
      const approvalMsg = formatApprovalMessage(regenRow.tweet_author, regenRow.tweet_text, newReply, regenRow.id);
      await sendTelegram(`🔄 Regenerated reply:\n\n${approvalMsg}`);
    } catch (err) {
      console.error('[Regen] Failed:', err);
      await sendTelegram(`❌ Failed to regenerate reply for #${regenRow.id}.`);
    }
  });

  // --- Approval flow ---
  // Only recognized patterns: "1", "2", "1 #ID", "2 #ID", "#ID custom reply text"
  bot.on('message', async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const text = (msg.text || '').trim();
    if (!text || text.startsWith('/')) return; // skip commands

    // Match: "1", "2", "1 #5", "2 #5"
    const approveMatch = text.match(/^([12])(?:\s+#(\d+))?\s*$/);
    // Match: "#5 custom reply text"
    const editMatch = text.match(/^#(\d+)\s+(.+)$/s);

    if (!approveMatch && !editMatch) {
      await sendTelegram('⚠️ Command not understood. Send /help for available commands.');
      return;
    }

    let pending: PendingReply | undefined;

    if (approveMatch) {
      const action = approveMatch[1]; // "1" or "2"
      const targetId = approveMatch[2] ? parseInt(approveMatch[2], 10) : null;

      if (targetId) {
        pending = db
          .prepare(
            `SELECT id, tweet_id, tweet_text, tweet_author, generated_reply, status
             FROM pending_replies WHERE id = ? AND status = 'pending'`
          )
          .get(targetId) as PendingReply | undefined;
        if (!pending) {
          await sendTelegram(`No pending reply with ID #${targetId}.`);
          return;
        }
      } else {
        pending = db
          .prepare(
            `SELECT id, tweet_id, tweet_text, tweet_author, generated_reply, status
             FROM pending_replies WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`
          )
          .get() as PendingReply | undefined;
        if (!pending) {
          await sendTelegram('No pending replies right now.');
          return;
        }
      }

      if (action === '1') {
        const success = await postReply(pending.tweet_id, pending.generated_reply);
        if (success) {
          db.prepare(
            `UPDATE pending_replies SET status = 'posted', final_reply = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).run(pending.generated_reply, pending.id);
          await sendTelegram(`✅ Reply posted to @${pending.tweet_author}! [#${pending.id}]`);
        } else {
          await sendTelegram(`❌ Failed to post reply [#${pending.id}]. Try again later.`);
        }
      } else {
        db.prepare(
          `UPDATE pending_replies SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(pending.id);
        await sendTelegram(`🚫 Reply rejected. [#${pending.id}]`);
      }
    } else if (editMatch) {
      const targetId = parseInt(editMatch[1], 10);
      const replyText = editMatch[2].trim();

      pending = db
        .prepare(
          `SELECT id, tweet_id, tweet_text, tweet_author, generated_reply, status
           FROM pending_replies WHERE id = ? AND status = 'pending'`
        )
        .get(targetId) as PendingReply | undefined;

      if (!pending) {
        await sendTelegram(`No pending reply with ID #${targetId}.`);
        return;
      }

      const success = await postReply(pending.tweet_id, replyText);
      if (success) {
        db.prepare(
          `UPDATE pending_replies SET status = 'edited', final_reply = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(replyText, pending.id);
        await sendTelegram(`✅ Your edited reply posted to @${pending.tweet_author}! [#${pending.id}]`);
      } else {
        await sendTelegram(`❌ Failed to post edited reply [#${pending.id}]. Try again later.`);
      }
    }
  });

  console.log('[Telegram] Bot commands registered.');
}
