import axios from 'axios';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { contentConfig } from '../config';
import { getContentDb } from '../db';
import { scrapeUserTweets } from './scraper';

const anthropic = new Anthropic({ apiKey: contentConfig.anthropic.apiKey });

interface ContextSource {
  id: number;
  type: string;
  url: string;
  raw_content: string | null;
  summary: string | null;
  last_scraped: string | null;
}

/**
 * Scrape a context source based on its type and store raw content + AI summary.
 */
export async function scrapeContextSource(type: string, url: string): Promise<{ id: number; summary: string }> {
  const db = getContentDb();
  let rawContent: string;

  switch (type) {
    case 'twitter':
      rawContent = await scrapeTwitterContext(url);
      break;
    case 'website':
    case 'url':
      rawContent = await scrapeWebPage(url);
      break;
    default:
      throw new Error(`Unknown source type: ${type}`);
  }

  if (!rawContent || rawContent.trim().length < 20) {
    throw new Error('Could not extract meaningful content from this source.');
  }

  // Truncate to ~15k chars to stay within reasonable token limits for summarization
  const truncated = rawContent.slice(0, 15000);
  const summary = await summarizeContent(type, url, truncated);

  // Upsert into context_sources
  const existing = db.prepare('SELECT id FROM context_sources WHERE type = ? AND url = ?').get(type, url) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE context_sources SET raw_content = ?, summary = ?, last_scraped = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(truncated, summary, existing.id);
    return { id: existing.id, summary };
  } else {
    const result = db.prepare(
      'INSERT INTO context_sources (type, url, raw_content, summary, last_scraped) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
    ).run(type, url, truncated, summary);
    return { id: Number(result.lastInsertRowid), summary };
  }
}

/**
 * Scrape a Twitter user's recent tweets and format them as context text.
 */
async function scrapeTwitterContext(username: string): Promise<string> {
  const tweets = await scrapeUserTweets(username.replace('@', ''));
  if (tweets.length === 0) throw new Error(`No tweets found for @${username}`);

  const lines: string[] = [`Twitter profile context for @${username}:`, ''];
  for (const t of tweets.slice(0, 30)) {
    lines.push(`[${t.likes}❤ ${t.retweets}🔁 ${t.replies}💬] ${t.text}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Import LinkedIn data from exported CSV content.
 * Accepts raw text from LinkedIn data export files (Profile.csv, Positions.csv, etc.)
 * or a single text blob with all the data pasted together.
 */
export async function importLinkedInData(rawContent: string): Promise<{ id: number; summary: string }> {
  if (!rawContent || rawContent.trim().length < 20) {
    throw new Error('LinkedIn data too short. Paste your exported LinkedIn data or send a CSV file.');
  }

  const truncated = rawContent.slice(0, 15000);
  const summary = await summarizeContent('linkedin', 'linkedin-export', truncated);

  const db = getContentDb();
  const existing = db.prepare("SELECT id FROM context_sources WHERE type = 'linkedin' AND url = 'linkedin-export'").get() as { id: number } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE context_sources SET raw_content = ?, summary = ?, last_scraped = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(truncated, summary, existing.id);
    return { id: existing.id, summary };
  } else {
    const result = db.prepare(
      "INSERT INTO context_sources (type, url, raw_content, summary, last_scraped) VALUES ('linkedin', 'linkedin-export', ?, ?, CURRENT_TIMESTAMP)"
    ).run(truncated, summary);
    return { id: Number(result.lastInsertRowid), summary };
  }
}

/**
 * Fetch a web page and extract text content.
 */
async function scrapeWebPage(url: string): Promise<string> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ContentBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: 15000,
    maxRedirects: 5,
  });

  const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  return stripHtmlToText(html);
}

/**
 * Basic HTML to text extraction — removes tags, scripts, styles, and collapses whitespace.
 */
function stripHtmlToText(html: string): string {
  let text = html;
  // Remove script/style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  // Replace block-level tags with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Use Claude to summarize scraped content into a useful context block.
 */
async function summarizeContent(type: string, url: string, rawContent: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `Summarize the following ${type} content from "${url}" into a concise profile/context summary that would help a content creator understand this person or topic. Focus on: key themes, expertise areas, writing style, and notable positions/opinions. Keep it under 500 words.

Content:
${rawContent}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type === 'text') return block.text;
  return 'Summary generation failed.';
}

/**
 * List all stored context sources.
 */
export function listContextSources(): ContextSource[] {
  const db = getContentDb();
  return db.prepare('SELECT id, type, url, summary, last_scraped FROM context_sources ORDER BY id').all() as ContextSource[];
}

/**
 * Re-scrape all existing context sources.
 */
export async function rescrapeAllSources(): Promise<{ total: number; updated: number; failed: number }> {
  const sources = listContextSources();
  let updated = 0;
  let failed = 0;

  for (const source of sources) {
    try {
      await scrapeContextSource(source.type, source.url);
      updated++;
    } catch (err) {
      console.error(`[Context] Failed to re-scrape ${source.type}:${source.url}:`, err);
      failed++;
    }
    // Rate limit
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { total: sources.length, updated, failed };
}

/**
 * Get all context summaries concatenated for use in AI prompts.
 */
export function getAllContextForPrompt(): string {
  const sections: string[] = [];

  // Load local context file if it exists
  const contextFilePath = path.resolve(__dirname, '../../../samit_twitter_bot_context.md');
  try {
    const localContext = fs.readFileSync(contextFilePath, 'utf-8');
    if (localContext.trim()) {
      sections.push(`[creator-profile]\n${localContext}`);
    }
  } catch {
    // File doesn't exist, skip
  }

  // Load DB context sources
  const db = getContentDb();
  const sources = db.prepare('SELECT type, url, summary FROM context_sources WHERE summary IS NOT NULL ORDER BY id').all() as { type: string; url: string; summary: string }[];
  for (const s of sources) {
    sections.push(`[${s.type}: ${s.url}]\n${s.summary}`);
  }

  return sections.join('\n\n---\n\n');
}
