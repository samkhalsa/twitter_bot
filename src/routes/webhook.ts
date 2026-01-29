import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { postReply, fetchUserTweets } from '../services/twitter';
import { generateReply } from '../services/ai';
import { sendWhatsApp, formatApprovalMessage } from '../services/whatsapp';
import { getLastPollTime } from '../index';

const router = Router();

interface PendingReply {
  id: number;
  tweet_id: string;
  tweet_author: string;
  generated_reply: string;
  status: string;
}

router.post('/webhook', async (req: Request, res: Response) => {
  const body = (req.body?.Body || '').trim();
  const from = req.body?.From || '';

  console.log(`[Webhook] Received from ${from}: "${body}" (length: ${body.length}, charCodes: ${[...body.slice(0, 20)].map(c => c.charCodeAt(0)).join(',')})`);

  // Twilio expects a quick response
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  const lower = body.toLowerCase();
  console.log(`[Webhook] lower="${lower}", startsWith fetch@=${lower.startsWith('fetch @')}, startsWith fetch=${lower.startsWith('fetch ')}`);
  const db = getDb();

  if (lower === 'help') {
    const helpText = [
      `📖 Commands:`,
      ``,
      `*Account Management*`,
      `• add @username — track a new account`,
      `• remove @username — stop tracking`,
      `• list — show all tracked accounts`,
      `• status — show bot stats`,
      `• fetch @username — fetch latest tweet & generate reply`,
      ``,
      `*Reply Approval*`,
      `• 1 — approve latest pending reply`,
      `• 1 #ID — approve specific reply`,
      `• 2 — reject latest pending reply`,
      `• 2 #ID — reject specific reply`,
      `• #ID your text — post custom reply`,
      ``,
      `*Regenerate*`,
      `• regen — regenerate latest reply`,
      `• regen #ID — regenerate specific reply`,
      `• regen make it funnier — regen with instructions`,
      `• regen #ID be more sarcastic — regen specific with instructions`,
    ];
    await sendWhatsApp(helpText.join('\n'));
    return;
  }

  // --- Account management commands ---

  if (lower.startsWith('add @') || lower.startsWith('add ')) {
    const username = body.slice(4).trim().replace(/^@/, '');
    if (!username) {
      await sendWhatsApp('Usage: add @username');
      return;
    }
    try {
      db.prepare('INSERT INTO tracked_accounts (username) VALUES (?)').run(username);
      await sendWhatsApp(`✅ Now tracking @${username}`);
    } catch {
      await sendWhatsApp(`⚠️ @${username} is already being tracked.`);
    }
    return;
  }

  if (lower.startsWith('remove @') || lower.startsWith('remove ')) {
    const username = body.slice(7).trim().replace(/^@/, '');
    if (!username) {
      await sendWhatsApp('Usage: remove @username');
      return;
    }
    const result = db.prepare('DELETE FROM tracked_accounts WHERE username = ?').run(username);
    if (result.changes > 0) {
      await sendWhatsApp(`✅ Stopped tracking @${username}`);
    } else {
      await sendWhatsApp(`⚠️ @${username} was not being tracked.`);
    }
    return;
  }

  if (lower === 'list') {
    const accounts = db
      .prepare('SELECT username FROM tracked_accounts ORDER BY added_at')
      .all() as { username: string }[];
    if (accounts.length === 0) {
      await sendWhatsApp('No tracked accounts. Send "add @username" to start.');
    } else {
      const list = accounts.map((a) => `• @${a.username}`).join('\n');
      await sendWhatsApp(`📋 Tracked accounts:\n${list}`);
    }
    return;
  }

  // --- Fetch latest tweet from a user: "fetch @username" ---
  if (lower.startsWith('fetch @') || lower.startsWith('fetch ')) {
    const username = body.replace(/^fetch\s+@?/i, '').trim();
    if (!username) {
      await sendWhatsApp('Usage: fetch @username');
      return;
    }

    console.log(`[Fetch] Command matched. Username: "${username}"`);

    try {
      await sendWhatsApp(`🔍 Fetching latest tweet from @${username}...`);
      const tweets = await fetchUserTweets(username, undefined, { skipTimeFilter: true });
      console.log(`[Fetch] Got ${tweets.length} tweets for @${username}`);

      if (tweets.length === 0) {
        await sendWhatsApp(`No recent tweets found for @${username}.`);
        return;
      }

      // Get the most recent tweet
      const latest = tweets[tweets.length - 1];

      // Check if we already have a pending reply for this tweet
      const existing = db
        .prepare('SELECT id FROM pending_replies WHERE tweet_id = ?')
        .get(latest.id) as { id: number } | undefined;

      if (existing) {
        await sendWhatsApp(`Already have a pending reply for this tweet [#${existing.id}].`);
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
      const msg = formatApprovalMessage(latest.author, latest.text, reply, pendingId, latest.createdAt);
      await sendWhatsApp(msg);
    } catch (err) {
      console.error('[Fetch] Failed:', err);
      await sendWhatsApp(`❌ Failed to fetch tweets for @${username}.`);
    }
    return;
  }

  if (lower === 'status') {
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
    const lines = [
      `📊 Bot Status:`,
      `• Tracked accounts: ${accounts.count}`,
      `• Pending replies: ${pendingCount.count}`,
      `• Posted replies: ${postedCount.count}`,
      `• Last poll: ${lastPoll ? lastPoll.toISOString() : 'never'}`,
    ];
    await sendWhatsApp(lines.join('\n'));
    return;
  }

  // --- Regen command: "regen", "regen #ID", "regen make it funnier", "regen #5 make it funnier" ---
  if (lower.startsWith('regen')) {
    const regenIdMatch = body.match(/#(\d+)/);
    const instructions = body.replace(/^regen\s*/i, '').replace(/#\d+\s*/, '').trim() || undefined;
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
      await sendWhatsApp('No pending reply to regenerate.');
      return;
    }

    try {
      const newReply = await generateReply(regenRow.tweet_text, regenRow.tweet_author, instructions);
      db.prepare('UPDATE pending_replies SET generated_reply = ? WHERE id = ?').run(newReply, regenRow.id);
      const msg = formatApprovalMessage(regenRow.tweet_author, regenRow.tweet_text, newReply, regenRow.id);
      await sendWhatsApp(`🔄 Regenerated reply:\n\n${msg}`);
    } catch (err) {
      console.error('[Regen] Failed:', err);
      await sendWhatsApp(`❌ Failed to regenerate reply for #${regenRow.id}.`);
    }
    return;
  }

  // --- Approval flow ---
  // Supports: "1 #ID", "2 #ID", "#ID edited text"
  // Falls back to latest pending if no #ID given

  const idMatch = body.match(/#(\d+)/);
  const targetId = idMatch ? parseInt(idMatch[1], 10) : null;

  let pending: PendingReply | undefined;

  if (targetId) {
    pending = db
      .prepare(
        `SELECT id, tweet_id, tweet_author, generated_reply, status
         FROM pending_replies
         WHERE id = ? AND status = 'pending'`
      )
      .get(targetId) as PendingReply | undefined;

    if (!pending) {
      await sendWhatsApp(`No pending reply with ID #${targetId}.`);
      return;
    }
  } else {
    pending = db
      .prepare(
        `SELECT id, tweet_id, tweet_author, generated_reply, status
         FROM pending_replies
         WHERE status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get() as PendingReply | undefined;

    if (!pending) {
      await sendWhatsApp('No pending replies right now. Commands: add, remove, list, status');
      return;
    }
  }

  // Strip the #ID part to get the actual command
  const command = body.replace(/#\d+/, '').trim();

  if (command === '1') {
    const success = await postReply(pending.tweet_id, pending.generated_reply);
    if (success) {
      db.prepare(
        `UPDATE pending_replies SET status = 'posted', final_reply = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(pending.generated_reply, pending.id);
      await sendWhatsApp(`✅ Reply posted to @${pending.tweet_author}! [#${pending.id}]`);
    } else {
      await sendWhatsApp(`❌ Failed to post reply [#${pending.id}]. Try again later.`);
    }
  } else if (command === '2') {
    db.prepare(
      `UPDATE pending_replies SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(pending.id);
    await sendWhatsApp(`🚫 Reply rejected. [#${pending.id}]`);
  } else {
    const replyText = command || body;
    const success = await postReply(pending.tweet_id, replyText);
    if (success) {
      db.prepare(
        `UPDATE pending_replies SET status = 'edited', final_reply = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(replyText, pending.id);
      await sendWhatsApp(`✅ Your edited reply posted to @${pending.tweet_author}! [#${pending.id}]`);
    } else {
      await sendWhatsApp(`❌ Failed to post edited reply [#${pending.id}]. Try again later.`);
    }
  }
});

export default router;
