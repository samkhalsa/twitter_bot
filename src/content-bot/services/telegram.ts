import TelegramBot from 'node-telegram-bot-api';
import { contentConfig } from '../config';
import { getContentDb } from '../db';
import { scrapeAndStoreAll, getTopTweets } from './scraper';
import { scrapeContextSource, listContextSources, rescrapeAllSources, importLinkedInData } from './context';
import { analyzeContent, generateIdeas, getPendingDrafts, updateDraftStatus, saveDraft } from './ai';
import { generateDailyDigest } from './digest';
import { postTweet } from './twitter-post';
import axios from 'axios';

const bot = new TelegramBot(contentConfig.telegram.botToken, { polling: true });
const CHAT_ID = contentConfig.telegram.chatId;

export async function sendContentTelegram(message: string): Promise<boolean> {
  try {
    await bot.sendMessage(CHAT_ID, message);
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Content Telegram] Failed to send message:', errMsg);
    return false;
  }
}

export function setupContentBotCommands() {
  const db = getContentDb();

  bot.on('message', (msg) => {
    console.log(`[Content Bot] Received: "${msg.text}" from chat ${msg.chat.id}`);
  });

  // /help
  bot.onText(/^\/help(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const help = [
      '📊 Content Creator Bot Commands:',
      '',
      '*Profile & Memory*',
      '• /profile — view your profile',
      '• /set key value — set profile field',
      '  Keys: name, bio, niche, goals, tone, audience, projects',
      '',
      '*Account Research*',
      '• /add username [category] — track account',
      '• /remove username — stop tracking',
      '• /list — show tracked accounts',
      '• /top [7d|30d] — top tweets by engagement',
      '',
      '*Context Sources*',
      '• /source twitter username — scrape your Twitter',
      '• /source linkedin — send LinkedIn data export ZIP/CSV as reply',
      '• /source website URL — scrape your website',
      '• /source url URL — scrape any URL',
      '• /sources — list all context sources',
      '• /rescrape — re-scrape all sources',
      '',
      '*Content*',
      '• /analyze — analyze what content works',
      '• /ideas — generate content ideas',
      '• /digest — send daily digest now',
      '• /drafts — show pending drafts',
      '• /save text — save a manual draft',
      '',
      '*Draft Approval*',
      '• 1 / 1 #ID — approve draft',
      '• 2 / 2 #ID — reject draft',
      '• #ID your text — save edited version',
      '',
      '• /status — bot stats',
      '• /scrape — manually scrape all accounts',
    ];
    await sendContentTelegram(help.join('\n'));
  });

  // /status
  bot.onText(/^\/status(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const accounts = db.prepare('SELECT COUNT(*) as count FROM content_accounts').get() as { count: number };
    const tweets = db.prepare('SELECT COUNT(*) as count FROM scraped_tweets').get() as { count: number };
    const drafts = db.prepare("SELECT COUNT(*) as count FROM content_drafts WHERE status = 'pending'").get() as { count: number };
    const sources = db.prepare('SELECT COUNT(*) as count FROM context_sources').get() as { count: number };
    const profileKeys = db.prepare('SELECT COUNT(*) as count FROM user_profile').get() as { count: number };

    const lines = [
      '📊 Content Bot Status:',
      `• Tracked accounts: ${accounts.count}`,
      `• Scraped tweets: ${tweets.count}`,
      `• Context sources: ${sources.count}`,
      `• Profile fields: ${profileKeys.count}`,
      `• Pending drafts: ${drafts.count}`,
    ];
    await sendContentTelegram(lines.join('\n'));
  });

  // /set key value
  bot.onText(/^\/set(?:@\S+)?\s+(\S+)\s+(.+)$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const key = match![1].toLowerCase();
    const value = match![2].trim();

    const validKeys = ['name', 'bio', 'niche', 'goals', 'tone', 'audience', 'projects'];
    if (!validKeys.includes(key)) {
      await sendContentTelegram(`⚠️ Invalid key. Valid keys: ${validKeys.join(', ')}`);
      return;
    }

    db.prepare(
      `INSERT INTO user_profile (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    ).run(key, value);

    await sendContentTelegram(`✅ Set ${key} = "${value}"`);
  });

  // /profile
  bot.onText(/^\/profile(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const rows = db.prepare('SELECT key, value FROM user_profile ORDER BY key').all() as { key: string; value: string }[];

    if (rows.length === 0) {
      await sendContentTelegram('No profile set yet. Use /set key value to add info.\nKeys: name, bio, niche, goals, tone, audience, projects');
      return;
    }

    const lines = ['👤 Your Profile:', ''];
    for (const row of rows) {
      lines.push(`• ${row.key}: ${row.value}`);
    }
    await sendContentTelegram(lines.join('\n'));
  });

  // /add username [category]
  bot.onText(/^\/add(?:@\S+)?\s+@?(\S+)(?:\s+(.+))?\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const username = match![1];
    const category = match![2]?.trim() || null;
    try {
      db.prepare('INSERT INTO content_accounts (username, category) VALUES (?, ?)').run(username, category);
      await sendContentTelegram(`✅ Now tracking @${username}${category ? ` [${category}]` : ''}`);
    } catch {
      await sendContentTelegram(`⚠️ @${username} is already being tracked.`);
    }
  });

  // /remove username
  bot.onText(/^\/remove(?:@\S+)?\s+@?(\S+)\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const username = match![1];
    const result = db.prepare('DELETE FROM content_accounts WHERE username = ?').run(username);
    if (result.changes > 0) {
      await sendContentTelegram(`✅ Stopped tracking @${username}`);
    } else {
      await sendContentTelegram(`⚠️ @${username} was not being tracked.`);
    }
  });

  // /list
  bot.onText(/^\/list(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const accounts = db
      .prepare('SELECT username, category FROM content_accounts ORDER BY added_at')
      .all() as { username: string; category: string | null }[];
    if (accounts.length === 0) {
      await sendContentTelegram('No tracked accounts. Use /add username [category] to start.');
    } else {
      const list = accounts.map((a) => `• @${a.username}${a.category ? ` [${a.category}]` : ''}`).join('\n');
      await sendContentTelegram(`📋 Tracked content accounts:\n${list}`);
    }
  });

  // /scrape — manually trigger scraping
  bot.onText(/^\/scrape(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    await sendContentTelegram('🔄 Scraping all tracked accounts...');
    try {
      const result = await scrapeAndStoreAll();
      await sendContentTelegram(`✅ Scraped ${result.accounts} accounts, ${result.newTweets} new tweets stored.`);
    } catch (err) {
      console.error('[Scrape] Failed:', err);
      await sendContentTelegram('❌ Scrape failed.');
    }
  });

  // /top [7d|30d]
  bot.onText(/^\/top(?:@\S+)?(?:\s+(7d|30d))?\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const period = match![1] || '7d';
    const days = period === '30d' ? 30 : 7;
    const tweets = getTopTweets(days, 10);

    if (tweets.length === 0) {
      await sendContentTelegram(`No tweets found in the last ${days} days. Run /scrape first.`);
      return;
    }

    const lines = [`🏆 Top tweets (last ${days} days):\n`];
    for (let i = 0; i < tweets.length; i++) {
      const t = tweets[i];
      lines.push(
        `${i + 1}. @${t.username} (score: ${t.score})`,
        `   ❤️${t.likes} 🔁${t.retweets} 💬${t.replies} 👁${t.views}`,
        `   "${t.text.slice(0, 100)}${t.text.length > 100 ? '...' : ''}"`,
        ''
      );
    }
    await sendContentTelegram(lines.join('\n'));
  });

  // /source linkedin — prompt to send file or paste data
  bot.onText(/^\/source(?:@\S+)?\s+linkedin\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    await sendContentTelegram(
      '📎 Send your LinkedIn data export:\n\n' +
      '1. Go to LinkedIn → Settings → Data Privacy → Get a copy of your data\n' +
      '2. Download the ZIP\n' +
      '3. Send any CSV file from it here (Profile.csv, Positions.csv, etc.)\n' +
      '   OR paste the text content as a message with /linkedin prefix\n\n' +
      'Example: /linkedin [paste your profile text here]'
    );
  });

  // /linkedin [text] — import pasted LinkedIn data
  bot.onText(/^\/linkedin(?:@\S+)?\s+(.+)$/is, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const text = match![1].trim();
    await sendContentTelegram('🔄 Processing LinkedIn data...');
    try {
      const result = await importLinkedInData(text);
      const preview = result.summary.slice(0, 300) + (result.summary.length > 300 ? '...' : '');
      await sendContentTelegram(`✅ LinkedIn data imported (#${result.id}).\n\nSummary:\n${preview}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await sendContentTelegram(`❌ Failed to import: ${errMsg}`);
    }
  });

  // Handle document uploads (CSV/TXT files for LinkedIn import)
  bot.on('document', async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const doc = msg.document;
    if (!doc) return;

    const name = (doc.file_name || '').toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt') && !name.endsWith('.json')) return;

    await sendContentTelegram(`🔄 Processing uploaded file: ${doc.file_name}...`);
    try {
      const fileLink = await bot.getFileLink(doc.file_id);
      const response = await axios.get(fileLink, { responseType: 'text' });
      const content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const result = await importLinkedInData(content);
      const preview = result.summary.slice(0, 300) + (result.summary.length > 300 ? '...' : '');
      await sendContentTelegram(`✅ LinkedIn data imported from ${doc.file_name} (#${result.id}).\n\nSummary:\n${preview}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await sendContentTelegram(`❌ Failed to process file: ${errMsg}`);
    }
  });

  // /source type url — add/scrape a context source
  bot.onText(/^\/source(?:@\S+)?\s+(twitter|website|url)\s+(\S+)\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const type = match![1].toLowerCase();
    const url = match![2];
    await sendContentTelegram(`🔄 Scraping ${type} source: ${url}...`);
    try {
      const result = await scrapeContextSource(type, url);
      const preview = result.summary.slice(0, 300) + (result.summary.length > 300 ? '...' : '');
      await sendContentTelegram(`✅ Context source saved (#${result.id}).\n\nSummary:\n${preview}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await sendContentTelegram(`❌ Failed to scrape: ${errMsg}`);
    }
  });

  // /sources — list all context sources
  bot.onText(/^\/sources(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const sources = listContextSources();
    if (sources.length === 0) {
      await sendContentTelegram('No context sources yet. Use /source type url to add one.');
      return;
    }
    const lines = ['📚 Context Sources:\n'];
    for (const s of sources) {
      const scraped = s.last_scraped ? `scraped ${s.last_scraped.slice(0, 10)}` : 'not scraped';
      lines.push(`#${s.id} [${s.type}] ${s.url} (${scraped})`);
    }
    await sendContentTelegram(lines.join('\n'));
  });

  // /rescrape — re-scrape all context sources
  bot.onText(/^\/rescrape(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    await sendContentTelegram('🔄 Re-scraping all context sources...');
    try {
      const result = await rescrapeAllSources();
      await sendContentTelegram(`✅ Re-scraped ${result.updated}/${result.total} sources.${result.failed > 0 ? ` (${result.failed} failed)` : ''}`);
    } catch (err) {
      await sendContentTelegram('❌ Re-scrape failed.');
    }
  });

  // /analyze [7d|30d] — analyze top content
  bot.onText(/^\/analyze(?:@\S+)?(?:\s+(7d|30d))?\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const days = match![1] === '30d' ? 30 : 7;
    await sendContentTelegram(`🔍 Analyzing top content from the last ${days} days...`);
    try {
      const analysis = await analyzeContent(days);
      if (analysis.length > 4000) {
        const mid = analysis.lastIndexOf('\n', 4000);
        await sendContentTelegram(analysis.slice(0, mid));
        await sendContentTelegram(analysis.slice(mid));
      } else {
        await sendContentTelegram(analysis);
      }
    } catch (err) {
      console.error('[Analyze] Failed:', err);
      await sendContentTelegram('❌ Analysis failed.');
    }
  });

  // /ideas [count] — generate content ideas
  bot.onText(/^\/ideas(?:@\S+)?(?:\s+(\d+))?\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const count = Math.min(parseInt(match![1] || '5', 10), 10);
    await sendContentTelegram(`💡 Generating ${count} content ideas...`);
    try {
      const { tweets: parsedTweets, raw } = await generateIdeas(count);

      // Save each parsed tweet as a draft
      const savedIds: number[] = [];
      for (const tweet of parsedTweets) {
        savedIds.push(saveDraft(tweet));
      }

      if (raw.length > 4000) {
        const mid = raw.lastIndexOf('\n', 4000);
        await sendContentTelegram(raw.slice(0, mid));
        await sendContentTelegram(raw.slice(mid));
      } else {
        await sendContentTelegram(raw);
      }

      if (savedIds.length > 0) {
        await sendContentTelegram(`✅ Saved ${savedIds.length} drafts (${savedIds.map(id => `#${id}`).join(', ')})\n\nUse /drafts to view. Approve: 1 #ID | Reject: 2 #ID | Edit: #ID your text`);
      }
    } catch (err) {
      console.error('[Ideas] Failed:', err);
      await sendContentTelegram('❌ Idea generation failed.');
    }
  });

  // /drafts — show pending drafts
  bot.onText(/^\/drafts(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const drafts = getPendingDrafts();
    if (drafts.length === 0) {
      await sendContentTelegram('No pending drafts. Use /ideas to generate some.');
      return;
    }
    const lines = ['📝 Pending Drafts:\n'];
    for (const d of drafts) {
      lines.push(`#${d.id} [${d.type}]`, `"${d.content}"`, '');
    }
    lines.push('Approve: 1 #ID | Reject: 2 #ID | Edit: #ID your text');
    await sendContentTelegram(lines.join('\n'));
  });

  // /save text — save a manual draft
  bot.onText(/^\/save(?:@\S+)?\s+(.+)$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const content = match![1].trim();
    const id = saveDraft(content);
    await sendContentTelegram(`✅ Draft saved as #${id}.\nApprove: 1 #${id} | Edit: #${id} your text`);
  });

  // 1 / 1 #ID — approve draft
  bot.onText(/^1(?:\s+#?(\d+))?\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const drafts = getPendingDrafts();
    if (drafts.length === 0) {
      await sendContentTelegram('No pending drafts.');
      return;
    }
    const id = match![1] ? parseInt(match![1], 10) : drafts[0].id;
    const draft = drafts.find((d) => d.id === id);
    if (!draft) {
      await sendContentTelegram(`⚠️ Draft #${id} not found or not pending.`);
      return;
    }
    updateDraftStatus(id, 'approved');
    await sendContentTelegram(`✅ Draft #${id} approved. Posting to Twitter...`);
    try {
      const tweetId = await postTweet(draft.content);
      if (tweetId) {
        await sendContentTelegram(`🐦 Posted! https://x.com/i/status/${tweetId}`);
        updateDraftStatus(id, 'posted');
      } else {
        await sendContentTelegram(`⚠️ Post returned no tweet ID. Check Twitter manually.`);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429) {
        await sendContentTelegram(`⚠️ Rate limited. Draft is approved — post manually later.`);
      } else {
        await sendContentTelegram(`❌ Failed to post: ${status || err.message}`);
      }
    }
  });

  // 2 / 2 #ID — reject draft
  bot.onText(/^2(?:\s+#?(\d+))?\s*$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const drafts = getPendingDrafts();
    if (drafts.length === 0) {
      await sendContentTelegram('No pending drafts.');
      return;
    }
    const id = match![1] ? parseInt(match![1], 10) : drafts[0].id;
    const draft = drafts.find((d) => d.id === id);
    if (!draft) {
      await sendContentTelegram(`⚠️ Draft #${id} not found or not pending.`);
      return;
    }
    updateDraftStatus(id, 'rejected');
    await sendContentTelegram(`🗑 Draft #${id} rejected.`);
  });

  // /digest — generate and send daily digest now
  bot.onText(/^\/digest(?:@\S+)?\s*$/i, async (msg) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    await sendContentTelegram('☀️ Generating daily digest...');
    try {
      const digest = await generateDailyDigest();
      if (digest.length > 4000) {
        const mid = digest.lastIndexOf('\n', 4000);
        await sendContentTelegram(digest.slice(0, mid));
        await sendContentTelegram(digest.slice(mid));
      } else {
        await sendContentTelegram(digest);
      }
    } catch (err) {
      console.error('[Digest] Failed:', err);
      await sendContentTelegram('❌ Digest generation failed.');
    }
  });

  // #ID text — edit and save draft
  bot.onText(/^#(\d+)\s+(.+)$/i, async (msg, match) => {
    if (String(msg.chat.id) !== CHAT_ID) return;
    const id = parseInt(match![1], 10);
    const newText = match![2].trim();
    const drafts = getPendingDrafts(100);
    const draft = drafts.find((d) => d.id === id);
    if (!draft) {
      await sendContentTelegram(`⚠️ Draft #${id} not found or not pending.`);
      return;
    }
    updateDraftStatus(id, 'edited', newText);
    await sendContentTelegram(`✏️ Draft #${id} updated. Posting to Twitter...`);
    try {
      const tweetId = await postTweet(newText);
      if (tweetId) {
        await sendContentTelegram(`🐦 Posted! https://x.com/i/status/${tweetId}`);
        updateDraftStatus(id, 'posted');
      } else {
        await sendContentTelegram(`⚠️ Post returned no tweet ID. Check Twitter manually.`);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429) {
        await sendContentTelegram(`⚠️ Rate limited. Draft is saved — post manually later.`);
      } else {
        await sendContentTelegram(`❌ Failed to post: ${status || err.message}`);
      }
    }
  });

  console.log('[Content Bot] Telegram commands registered.');
}

export function getBotInstance(): TelegramBot {
  return bot;
}
