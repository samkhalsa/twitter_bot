import Anthropic from '@anthropic-ai/sdk';
import { contentConfig } from '../config';
import { getContentDb } from '../db';
import { getTopTweets } from './scraper';
import { getAllContextForPrompt } from './context';

const anthropic = new Anthropic({ apiKey: contentConfig.anthropic.apiKey });

function getUserProfile(): string {
  const db = getContentDb();
  const rows = db.prepare('SELECT key, value FROM user_profile ORDER BY key').all() as { key: string; value: string }[];
  if (rows.length === 0) return 'No user profile set.';
  return rows.map((r) => `${r.key}: ${r.value}`).join('\n');
}

/**
 * Analyze top-performing tweets to identify patterns and insights.
 */
export async function analyzeContent(days: number = 7): Promise<string> {
  const tweets = getTopTweets(days, 20);
  if (tweets.length === 0) {
    return 'No tweets to analyze. Run /c_scrape first.';
  }

  const tweetBlock = tweets
    .map((t, i) => `${i + 1}. @${t.username} (❤${t.likes} 🔁${t.retweets} 💬${t.replies} 👁${t.views})\n"${t.text}"`)
    .join('\n\n');

  const profile = getUserProfile();
  const context = getAllContextForPrompt();

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are a content strategist. Analyze these top-performing tweets from the last ${days} days and provide actionable insights.

USER PROFILE:
${profile}

${context ? `CONTEXT SOURCES:\n${context}\n` : ''}
TOP TWEETS:
${tweetBlock}

Provide a concise analysis covering:
1. Content patterns that drive engagement (topics, formats, hooks)
2. Optimal tweet structures (length, tone, use of questions/lists/threads)
3. What the audience responds to most
4. 3-5 specific, actionable recommendations for the user's content strategy

Keep it practical and specific — no generic advice. Reference actual tweets as examples.`,
      },
    ],
  });

  const block = message.content[0];
  return block.type === 'text' ? block.text : 'Analysis failed.';
}

/**
 * Generate content ideas based on trending topics and user profile.
 */
export async function generateIdeas(count: number = 5): Promise<{ tweets: string[]; raw: string }> {
  const tweets = getTopTweets(7, 15);
  const profile = getUserProfile();
  const context = getAllContextForPrompt();

  const tweetBlock = tweets.length > 0
    ? tweets.map((t) => `@${t.username}: "${t.text.slice(0, 150)}"`).join('\n')
    : 'No recent tweets scraped.';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are a content strategist. Generate ${count} tweet ideas for this creator.

USER PROFILE:
${profile}

${context ? `CONTEXT SOURCES:\n${context}\n` : ''}
TRENDING/TOP CONTENT IN THEIR NICHE:
${tweetBlock}

Generate ${count} tweet ideas. For each:
- Write the full tweet text (ready to post, under 280 chars) wrapped in <tweet>...</tweet> tags
- Brief note on why it should perform well

Style: lowercase, conversational, no hashtags or emojis. Sound like a real person sharing genuine thoughts, not a brand.`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') return { tweets: [], raw: 'Idea generation failed.' };

  const raw = block.text;
  const tweetMatches = [...raw.matchAll(/<tweet>([\s\S]*?)<\/tweet>/g)];
  const parsed = tweetMatches.map((m) => m[1].trim());

  return { tweets: parsed, raw };
}

/**
 * Generate a single draft tweet from a specific inspiration tweet.
 */
export async function generateDraftFromTweet(tweetId: string): Promise<{ content: string } | null> {
  const db = getContentDb();
  const tweet = db.prepare('SELECT * FROM scraped_tweets WHERE tweet_id = ?').get(tweetId) as {
    tweet_id: string; username: string; text: string;
  } | undefined;

  if (!tweet) return null;

  const profile = getUserProfile();
  const context = getAllContextForPrompt();

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Write an original tweet inspired by this one, adapted to the user's voice and niche.

USER PROFILE:
${profile}

${context ? `CONTEXT:\n${context}\n` : ''}
INSPIRATION TWEET by @${tweet.username}:
"${tweet.text}"

Write ONE tweet (under 280 chars). Don't copy — take the core idea and make it your own. Style: lowercase, conversational, no hashtags or emojis. Just output the tweet text, nothing else.`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') return null;

  const content = block.text.replace(/^["']|["']$/g, '').trim();

  // Store as draft
  db.prepare(
    'INSERT INTO content_drafts (type, content, inspiration_tweet_id, status) VALUES (?, ?, ?, ?)'
  ).run('tweet', content, tweetId, 'pending');

  return { content };
}

/**
 * Save a generated idea as a pending draft.
 */
export function saveDraft(content: string, type: string = 'tweet'): number {
  const db = getContentDb();
  const result = db.prepare(
    'INSERT INTO content_drafts (type, content, status) VALUES (?, ?, ?)'
  ).run(type, content, 'pending');
  return Number(result.lastInsertRowid);
}

/**
 * Get pending drafts.
 */
export function getPendingDrafts(limit: number = 10) {
  const db = getContentDb();
  return db.prepare(
    "SELECT id, type, content, inspiration_tweet_id, created_at FROM content_drafts WHERE status = 'pending' ORDER BY id DESC LIMIT ?"
  ).all(limit) as { id: number; type: string; content: string; inspiration_tweet_id: string | null; created_at: string }[];
}

/**
 * Update draft status.
 */
export function updateDraftStatus(id: number, status: string, finalContent?: string) {
  const db = getContentDb();
  if (finalContent) {
    db.prepare('UPDATE content_drafts SET status = ?, content = ? WHERE id = ?').run(status, finalContent, id);
  } else {
    db.prepare('UPDATE content_drafts SET status = ? WHERE id = ?').run(status, id);
  }
}
