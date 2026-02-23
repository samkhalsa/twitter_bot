import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { getDb, getTodayEngagementCount } from '../db';
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
  createdAt?: string,
  tweetUrl?: string
): string {
  const postedAgo = createdAt ? ` (${timeAgo(createdAt)})` : '';
  const urlLine = tweetUrl ? `\n🔗 ${tweetUrl}` : '';
  return [
    `🐦 New tweet from @${escapeMarkdown(tweetAuthor)}${postedAgo}:`,
    `"${escapeMarkdown(tweetText)}"${urlLine}`,
    ``,
    `💬 Suggested reply:`,
    `"${escapeMarkdown(generatedReply)}"`,
    ``,
    `[ID: ${pendingId}]`,
    `Reply with:`,
    `• 1 #${pendingId} — Approve & post`,
    `• 2 #${pendingId} — Reject`,
    `• #${pendingId} your text — Post custom reply`,
  ].join('\n');
}

interface DigestItem {
  id: number;
  author: string;
  followers: number;
  tweetPreview: string;
  reply: string;
  sourceLabel: string;
  tweetUrl?: string;
}

export async function sendDigestMessage(items: DigestItem[]): Promise<void> {
  // Send a summary header
  const ids = items.map(i => i.id);
  const header = [
    `🔍 *${items.length} new replies ready*`,
    ``,
    `Approve: \`1 #ID\` or \`1 #ID #ID #ID\``,
    `Reject: \`2 #ID\` or \`2 all\``,
    `Edit: \`#ID your reply text\``,
    `Regen: \`/regen #ID\``,
    ``,
    `IDs: ${ids.join(', ')}`,
  ].join('\n');
  await sendTelegram(header);

  // Send each candidate as a compact individual message (so they're scrollable)
  for (const item of items) {
    const tweetPreview = escapeMarkdown(item.tweetPreview);
    const replyPreview = escapeMarkdown(item.reply);
    const url = item.tweetUrl ? `\n🔗 ${item.tweetUrl}` : '';
    const msg = [
      `*#${item.id}* — @${escapeMarkdown(item.author)} (${item.followers})`,
      `"${tweetPreview}"${url}`,
      ``,
      `💬 "${replyPreview}"`,
    ].join('\n');
    await sendTelegram(msg);
  }
}

interface PendingReply {
  id: number;
  tweet_id: string;
  tweet_text: string;
  tweet_author: string;
  generated_reply: string;
  status: string;
  author_followers: number | null;
  source_query: string | null;
  source_type: string | null;
}

function logRepliedAuthor(pending: PendingReply, replyTweetId?: string) {
  const db = getDb();
  try {
    db.prepare(
      `INSERT OR IGNORE INTO replied_authors (username, tweet_id, reply_id, follower_count, source_query, reply_tweet_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(pending.tweet_author, pending.tweet_id, pending.id, pending.author_followers, pending.source_query, replyTweetId || null);
  } catch (err) {
    console.error('[Follow] Failed to log replied author:', err);
  }
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

const DAILY_GOAL = 100;

function engagementBar(count: number): string {
  const pct = Math.min(count / DAILY_GOAL, 1);
  const filled = Math.round(pct * 20);
  const empty = 20 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `${bar} ${Math.round(pct * 100)}%`;
}

function engagementSummary(): string {
  const count = getTodayEngagementCount();
  return `📈 *Today: ${count}/${DAILY_GOAL}*\n${engagementBar(count)}`;
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
      `*Search Discovery*`,
      `• /addsearch query — add a search query`,
      `• /removesearch query — remove a search query`,
      `• /searches — list all search queries`,
      `• /search — run search discovery now`,
      `• /searchon — enable search polling`,
      `• /searchoff — disable search polling`,
      ``,
      `*Feedback & Stats*`,
      `• /feedback — check engagement & follow-backs now`,
      `• /count — daily engagement counter (goal: ${DAILY_GOAL})`,
      ``,
      `*Communities*`,
      `• /addcommunity ID Name — track a community`,
      `• /removecommunity ID — stop tracking`,
      `• /communities — list tracked communities`,
      ``,
      `*Reply Approval*`,
      `• 1 #ID — approve specific reply`,
      `• 1 #ID #ID #ID — approve multiple`,
      `• 2 #ID — reject specific reply`,
      `• 2 #ID #ID — reject multiple`,
      `• 2 all — reject all pending`,
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
      const approvalMsg = formatApprovalMessage(latest.author, latest.text, reply, pendingId, latest.createdAt, latest.url);
      await sendTelegram(approvalMsg);
    } catch (err) {
      console.error('[Fetch] Failed:', err);
      await sendTelegram(`❌ Failed to fetch tweets for @${username}.`);
    }
  });

  // --- Search Discovery Commands ---

  bot.onText(/^\/addsearch(?:@\S+)?\s+(.+)\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const query = match![1].trim();
    try {
      db.prepare('INSERT INTO search_queries (query) VALUES (?)').run(query);
      await sendTelegram(`✅ Search query added: "${query}"`);
    } catch {
      await sendTelegram(`⚠️ Query "${query}" already exists.`);
    }
  });

  bot.onText(/^\/removesearch(?:@\S+)?\s+(.+)\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const query = match![1].trim();
    const result = db.prepare('DELETE FROM search_queries WHERE query = ?').run(query);
    if (result.changes > 0) {
      await sendTelegram(`✅ Removed search query: "${query}"`);
    } else {
      await sendTelegram(`⚠️ Query "${query}" not found.`);
    }
  });

  bot.onText(/^\/searches(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const queries = db
      .prepare('SELECT query, status, hits, replies_sent, follow_backs, last_searched_at FROM search_queries ORDER BY created_at')
      .all() as { query: string; status: string; hits: number; replies_sent: number; follow_backs: number; last_searched_at: string | null }[];

    if (queries.length === 0) {
      await sendTelegram('No search queries. Send /addsearch query to add one.');
      return;
    }

    const lines = queries.map((q) => {
      const status = q.status === 'active' ? '🟢' : '⏸';
      const lastSearch = q.last_searched_at ? ` (last: ${timeAgo(q.last_searched_at)})` : '';
      return `${status} "${q.query}" — ${q.hits} hits, ${q.replies_sent} replies${lastSearch}`;
    });
    await sendTelegram(`🔍 *Search Queries:*\n${lines.join('\n')}`);
  });

  bot.onText(/^\/search(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const idx = getIndexExports();
    if (!idx) { await sendTelegram('❌ Bot not ready.'); return; }
    await sendTelegram('🔍 Running search discovery now...');
    try {
      await idx.triggerSearch();
      await sendTelegram('✅ Search complete.');
    } catch (err) {
      console.error('[Search] Manual search error:', err);
      await sendTelegram('❌ Search failed.');
    }
  });

  bot.onText(/^\/searchon(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const idx = getIndexExports();
    if (!idx) { await sendTelegram('❌ Bot not ready.'); return; }
    if (idx.startSearch()) {
      await sendTelegram('▶️ Search polling started.');
    } else {
      await sendTelegram('⚠️ Search polling is already running.');
    }
  });

  bot.onText(/^\/feedback(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const idx = getIndexExports();
    if (!idx) { await sendTelegram('❌ Bot not ready.'); return; }
    await sendTelegram('📊 Running feedback check now...');
    try {
      await idx.triggerFeedback();
      await sendTelegram('✅ Feedback check complete.');
    } catch (err) {
      console.error('[Feedback] Manual feedback error:', err);
      await sendTelegram('❌ Feedback check failed.');
    }
  });

  bot.onText(/^\/count(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    await sendTelegram(engagementSummary());
  });

  bot.onText(/^\/searchoff(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const idx = getIndexExports();
    if (!idx) { await sendTelegram('❌ Bot not ready.'); return; }
    if (idx.stopSearch()) {
      await sendTelegram('⏸ Search polling stopped.');
    } else {
      await sendTelegram('⚠️ Search polling is already stopped.');
    }
  });

  // --- Community Commands ---

  bot.onText(/^\/addcommunity(?:@\S+)?\s+(\S+)\s+(.+)\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const communityId = match![1].trim();
    const name = match![2].trim();
    try {
      db.prepare('INSERT INTO tracked_communities (community_id, name) VALUES (?, ?)').run(communityId, name);
      await sendTelegram(`✅ Community added: "${name}" (${communityId})`);
    } catch {
      await sendTelegram(`⚠️ Community ${communityId} is already tracked.`);
    }
  });

  bot.onText(/^\/removecommunity(?:@\S+)?\s+(\S+)\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const communityId = match![1].trim();
    const result = db.prepare('DELETE FROM tracked_communities WHERE community_id = ?').run(communityId);
    if (result.changes > 0) {
      await sendTelegram(`✅ Removed community ${communityId}`);
    } else {
      await sendTelegram(`⚠️ Community ${communityId} not found.`);
    }
  });

  bot.onText(/^\/communities(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const communities = db
      .prepare('SELECT community_id, name, status, hits, replies_sent, last_polled_at FROM tracked_communities ORDER BY created_at')
      .all() as { community_id: string; name: string; status: string; hits: number; replies_sent: number; last_polled_at: string | null }[];

    if (communities.length === 0) {
      await sendTelegram('No communities tracked. Send /addcommunity ID Name to add one.');
      return;
    }

    const lines = communities.map((c) => {
      const status = c.status === 'active' ? '🟢' : '⏸';
      const lastPoll = c.last_polled_at ? ` (last: ${timeAgo(c.last_polled_at)})` : '';
      return `${status} "${c.name}" — ${c.hits} hits, ${c.replies_sent} replies${lastPoll}`;
    });
    await sendTelegram(`🏘️ *Communities:*\n${lines.join('\n')}`);
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
    const searchState = idx?.isSearchEnabled() ? '▶️ running' : '⏸ stopped';
    const lastSearch = idx?.getLastSearchTime();
    const searchQueryCount = (db.prepare("SELECT COUNT(*) as count FROM search_queries WHERE status = 'active'").get() as { count: number }).count;
    const searchPending = (db.prepare("SELECT COUNT(*) as count FROM pending_replies WHERE source_type = 'search' AND status = 'pending'").get() as { count: number }).count;
    const communityCount = (db.prepare("SELECT COUNT(*) as count FROM tracked_communities WHERE status = 'active'").get() as { count: number }).count;
    const communityPending = (db.prepare("SELECT COUNT(*) as count FROM pending_replies WHERE source_type = 'community' AND status = 'pending'").get() as { count: number }).count;
    const totalReplied = (db.prepare("SELECT COUNT(*) as count FROM replied_authors").get() as { count: number }).count;
    const followBacks = (db.prepare("SELECT COUNT(*) as count FROM replied_authors WHERE followed_back = 1").get() as { count: number }).count;
    const replyBacks = (db.prepare("SELECT COUNT(*) as count FROM replied_authors WHERE got_reply_back = 1").get() as { count: number }).count;
    const lastFeedback = idx?.getLastFeedbackTime();

    const todayCount = getTodayEngagementCount();

    const lines = [
      `📊 *Bot Status:*`,
      ``,
      `*Daily Engagement: ${todayCount}/${DAILY_GOAL}*`,
      engagementBar(todayCount),
      ``,
      `*Account Polling*`,
      `• Status: ${pollingState}`,
      `• Tracked accounts: ${accounts.count}`,
      `• Last poll: ${lastPoll ? lastPoll.toISOString() : 'never'}`,
      ``,
      `*Search Discovery*`,
      `• Status: ${searchState}`,
      `• Active queries: ${searchQueryCount}`,
      `• Communities: ${communityCount}`,
      `• Search pending: ${searchPending}`,
      `• Community pending: ${communityPending}`,
      `• Last search: ${lastSearch ? lastSearch.toISOString() : 'never'}`,
      ``,
      `*Replies*`,
      `• Pending: ${pendingCount.count}`,
      `• Posted: ${postedCount.count}`,
      ``,
      `*Feedback Loop*`,
      `• Authors replied to: ${totalReplied}`,
      `• Follow-backs: ${followBacks}`,
      `• Reply-backs: ${replyBacks}`,
      `• Last check: ${lastFeedback ? lastFeedback.toISOString() : 'never'}`,
    ];
    await sendTelegram(lines.join('\n'));
  });

  bot.onText(/^\/regen(?:@\S+)?(.*)$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const args = (match![1] || '').trim();
    const regenIdMatch = args.match(/#?(\d+)/);
    const instructions = args.replace(/#?\d+\s*/, '').trim() || undefined;
    let regenRow: { id: number; tweet_text: string; tweet_author: string; tweet_url: string | null } | undefined;

    if (regenIdMatch) {
      regenRow = db
        .prepare('SELECT id, tweet_text, tweet_author, tweet_url FROM pending_replies WHERE id = ? AND status = ?')
        .get(parseInt(regenIdMatch[1], 10), 'pending') as typeof regenRow;
    } else {
      regenRow = db
        .prepare('SELECT id, tweet_text, tweet_author, tweet_url FROM pending_replies WHERE status = ? ORDER BY created_at DESC LIMIT 1')
        .get('pending') as typeof regenRow;
    }

    if (!regenRow) {
      await sendTelegram('No pending reply to regenerate.');
      return;
    }

    try {
      const newReply = await generateReply(regenRow.tweet_text, regenRow.tweet_author, instructions);
      db.prepare('UPDATE pending_replies SET generated_reply = ? WHERE id = ?').run(newReply, regenRow.id);
      const approvalMsg = formatApprovalMessage(regenRow.tweet_author, regenRow.tweet_text, newReply, regenRow.id, undefined, regenRow.tweet_url || undefined);
      await sendTelegram(`🔄 Regenerated reply:\n\n${approvalMsg}`);
    } catch (err) {
      console.error('[Regen] Failed:', err);
      await sendTelegram(`❌ Failed to regenerate reply for #${regenRow.id}.`);
    }
  });

  // --- Approval flow ---
  // Patterns:
  //   "1 #45"           — approve one
  //   "1 #45 #47 #52"   — approve multiple
  //   "2 #45"           — reject one
  //   "2 #45 #47"       — reject multiple
  //   "2 all"           — reject all pending
  //   "#45 custom text"  — post custom reply for #45
  bot.on('message', async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    let text = (msg.text || '').trim();
    if (!text || text.startsWith('/')) return; // skip commands

    // --- Reply-to-message: extract ID from the original message ---
    // If user replies to a candidate message with "1", "2", or custom text,
    // extract the #ID from the original message and rewrite the command
    if (msg.reply_to_message?.text) {
      const originalText = msg.reply_to_message.text;
      const idMatch = originalText.match(/#(\d+)/);
      if (idMatch) {
        const id = idMatch[1];
        if (text === '1') {
          text = `1 #${id}`;
        } else if (text === '2') {
          text = `2 #${id}`;
        } else if (!text.startsWith('#') && !text.match(/^[12]\s/)) {
          // Bare text reply = custom reply for that ID
          text = `#${id} ${text}`;
        }
      }
    }

    // Match: "1 #45 #47 #52" or "2 #45 #47" (one or more IDs)
    const multiMatch = text.match(/^([12])\s+((?:#\d+\s*)+)$/);
    // Match: "2 all"
    const rejectAllMatch = text.match(/^2\s+all\s*$/i);
    // Match: "#45 custom reply text"
    const editMatch = text.match(/^#(\d+)\s+(.+)$/s);

    if (!multiMatch && !rejectAllMatch && !editMatch) {
      // Check if they sent bare "1" or "2" without ID (and no reply-to-message)
      if (text === '1' || text === '2') {
        await sendTelegram('⚠️ Please specify an ID: `1 #ID` to approve, `2 #ID` to reject. Or reply to a candidate message.');
        return;
      }
      await sendTelegram('⚠️ Command not understood. Send /help for available commands.');
      return;
    }

    if (rejectAllMatch) {
      const allPending = db
        .prepare("SELECT id FROM pending_replies WHERE status = 'pending'")
        .all() as { id: number }[];

      if (allPending.length === 0) {
        await sendTelegram('No pending replies to reject.');
        return;
      }

      const stmt = db.prepare("UPDATE pending_replies SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP WHERE id = ?");
      for (const row of allPending) {
        stmt.run(row.id);
      }
      await sendTelegram(`🚫 Rejected all ${allPending.length} pending replies.`);
      return;
    }

    if (multiMatch) {
      const action = multiMatch[1]; // "1" or "2"
      const ids = [...multiMatch[2].matchAll(/#(\d+)/g)].map(m => parseInt(m[1], 10));

      if (ids.length === 0) {
        await sendTelegram('⚠️ No valid IDs found.');
        return;
      }

      let posted = 0;
      let rejected = 0;
      let failed = 0;

      for (const targetId of ids) {
        const pending = db
          .prepare(
            `SELECT id, tweet_id, tweet_text, tweet_author, generated_reply, status, author_followers, source_query, source_type
             FROM pending_replies WHERE id = ? AND status = 'pending'`
          )
          .get(targetId) as PendingReply | undefined;

        if (!pending) {
          await sendTelegram(`⚠️ #${targetId} not found or already resolved.`);
          continue;
        }

        if (action === '1') {
          const replyTweetId = await postReply(pending.tweet_id, pending.generated_reply);
          if (replyTweetId) {
            db.prepare(
              `UPDATE pending_replies SET status = 'posted', final_reply = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
            ).run(pending.generated_reply, pending.id);
            logRepliedAuthor(pending, replyTweetId);
            if (pending.source_type === 'search' && pending.source_query) {
              db.prepare('UPDATE search_queries SET replies_sent = replies_sent + 1 WHERE query = ?').run(pending.source_query);
            } else if (pending.source_type === 'community' && pending.source_query) {
              db.prepare('UPDATE tracked_communities SET replies_sent = replies_sent + 1 WHERE name = ?').run(pending.source_query);
            }
            posted++;
          } else {
            failed++;
            await sendTelegram(`❌ Failed to post #${pending.id}.`);
          }
          // Small delay between posts to avoid rate limits
          await new Promise(r => setTimeout(r, 2000));
        } else {
          db.prepare(
            `UPDATE pending_replies SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).run(pending.id);
          rejected++;
        }
      }

      if (action === '1') {
        const dayCount = getTodayEngagementCount();
        await sendTelegram(`✅ Approved ${posted}/${ids.length} replies.${failed > 0 ? ` ${failed} failed.` : ''}\n\n📈 Today: ${dayCount}/${DAILY_GOAL}`);
      } else {
        await sendTelegram(`🚫 Rejected ${rejected} replies.`);
      }
      return;
    }

    if (editMatch) {
      const targetId = parseInt(editMatch[1], 10);
      const replyText = editMatch[2].trim();

      const pending = db
        .prepare(
          `SELECT id, tweet_id, tweet_text, tweet_author, generated_reply, status, author_followers, source_query, source_type
           FROM pending_replies WHERE id = ? AND status = 'pending'`
        )
        .get(targetId) as PendingReply | undefined;

      if (!pending) {
        await sendTelegram(`No pending reply with ID #${targetId}.`);
        return;
      }

      const replyTweetId = await postReply(pending.tweet_id, replyText);
      if (replyTweetId) {
        db.prepare(
          `UPDATE pending_replies SET status = 'edited', final_reply = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(replyText, pending.id);
        logRepliedAuthor(pending, replyTweetId);
        if (pending.source_type === 'search' && pending.source_query) {
          db.prepare('UPDATE search_queries SET replies_sent = replies_sent + 1 WHERE query = ?').run(pending.source_query);
        } else if (pending.source_type === 'community' && pending.source_query) {
          db.prepare('UPDATE tracked_communities SET replies_sent = replies_sent + 1 WHERE name = ?').run(pending.source_query);
        }
        const dayCount = getTodayEngagementCount();
        await sendTelegram(`✅ Custom reply posted to @${pending.tweet_author}! [#${pending.id}]\n\n📈 Today: ${dayCount}/${DAILY_GOAL}`);
      } else {
        await sendTelegram(`❌ Failed to post edited reply [#${pending.id}].`);
      }
    }
  });

  console.log('[Telegram] Bot commands registered.');
}
