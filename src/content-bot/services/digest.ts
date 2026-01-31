import Anthropic from '@anthropic-ai/sdk';
import { contentConfig } from '../config';
import { getContentDb } from '../db';
import { getTopTweets } from './scraper';
import { getAllContextForPrompt } from './context';
import { getPendingDrafts } from './ai';

const anthropic = new Anthropic({ apiKey: contentConfig.anthropic.apiKey });

function getUserProfile(): string {
  const db = getContentDb();
  const rows = db.prepare('SELECT key, value FROM user_profile ORDER BY key').all() as { key: string; value: string }[];
  if (rows.length === 0) return 'No user profile set.';
  return rows.map((r) => `${r.key}: ${r.value}`).join('\n');
}

/**
 * Generate and store a daily digest: top tweets analysis + content ideas + pending drafts summary.
 */
export async function generateDailyDigest(): Promise<string> {
  const db = getContentDb();
  const topTweets = getTopTweets(1, 10); // last 24h
  const weeklyTop = getTopTweets(7, 5);
  const pendingDrafts = getPendingDrafts(5);
  const profile = getUserProfile();
  const context = getAllContextForPrompt();

  const tweetBlock = topTweets.length > 0
    ? topTweets.map((t, i) => `${i + 1}. @${t.username} (❤${t.likes} 🔁${t.retweets} 💬${t.replies})\n"${t.text.slice(0, 150)}"`).join('\n\n')
    : 'No new tweets in the last 24 hours.';

  const weeklyBlock = weeklyTop.length > 0
    ? weeklyTop.map((t, i) => `${i + 1}. @${t.username}: "${t.text.slice(0, 100)}"`).join('\n')
    : '';

  const draftsBlock = pendingDrafts.length > 0
    ? pendingDrafts.map((d) => `#${d.id}: "${d.content.slice(0, 100)}"`).join('\n')
    : 'No pending drafts.';

  // Stats
  const accountCount = (db.prepare('SELECT COUNT(*) as c FROM content_accounts').get() as { c: number }).c;
  const totalTweets = (db.prepare('SELECT COUNT(*) as c FROM scraped_tweets').get() as { c: number }).c;
  const postedDrafts = (db.prepare("SELECT COUNT(*) as c FROM content_drafts WHERE status IN ('approved', 'edited')").get() as { c: number }).c;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `Create a concise daily content digest for this creator. Be specific and actionable.

USER PROFILE:
${profile}

${context ? `CONTEXT:\n${context}\n` : ''}
TODAY'S TOP TWEETS (last 24h):
${tweetBlock}

${weeklyBlock ? `THIS WEEK'S BEST:\n${weeklyBlock}\n` : ''}
STATS: ${accountCount} tracked accounts, ${totalTweets} total tweets scraped, ${postedDrafts} drafts posted

PENDING DRAFTS:
${draftsBlock}

Write a morning digest that includes:
1. Key takeaway from yesterday's top content (2-3 sentences)
2. One specific content opportunity for today
3. 2 ready-to-post tweet suggestions (under 280 chars each, lowercase, no hashtags/emojis)
4. Reminder of pending drafts if any

Keep it concise — this goes in a Telegram message. Use plain text, no markdown.`,
      },
    ],
  });

  const block = message.content[0];
  const digestText = block.type === 'text' ? block.text : 'Digest generation failed.';

  // Store digest
  db.prepare('INSERT INTO daily_digests (digest_text) VALUES (?)').run(digestText);

  return digestText;
}
