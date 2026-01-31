import cron from 'node-cron';
import { getContentDb, closeContentDb } from './db';
import { setupContentBotCommands, sendContentTelegram } from './services/telegram';
import { scrapeAndStoreAll } from './services/scraper';
import { rescrapeAllSources } from './services/context';
import { generateDailyDigest } from './services/digest';
import { contentConfig } from './config';

console.log('[Content Bot] Starting Content Creator Bot...');

const db = getContentDb();
console.log('[Content Bot] Database initialized.');

setupContentBotCommands();
console.log('[Content Bot] Telegram bot started.');

sendContentTelegram('🚀 Content Creator Bot is online!').catch(() => {});

// --- Scheduled Jobs ---

// Scrape tracked accounts every 6 hours
cron.schedule('0 */6 * * *', async () => {
  console.log('[Cron] Scraping tracked accounts...');
  try {
    const result = await scrapeAndStoreAll();
    console.log(`[Cron] Scraped ${result.accounts} accounts, ${result.newTweets} new tweets.`);
  } catch (err) {
    console.error('[Cron] Scrape failed:', err);
  }
});

// Re-scrape context sources daily at 3am
cron.schedule('0 3 * * *', async () => {
  console.log('[Cron] Re-scraping context sources...');
  try {
    const result = await rescrapeAllSources();
    console.log(`[Cron] Re-scraped ${result.updated}/${result.total} sources.`);
  } catch (err) {
    console.error('[Cron] Context re-scrape failed:', err);
  }
});

// Daily digest at configured hour
cron.schedule(`0 ${contentConfig.digestHour} * * *`, async () => {
  console.log('[Cron] Generating daily digest...');
  try {
    const digest = await generateDailyDigest();
    await sendContentTelegram(`☀️ Daily Content Digest\n\n${digest}`);
    console.log('[Cron] Daily digest sent.');
  } catch (err) {
    console.error('[Cron] Digest failed:', err);
    await sendContentTelegram('❌ Daily digest generation failed.').catch(() => {});
  }
}, { timezone: contentConfig.digestTimezone });

console.log(`[Content Bot] Scheduled: scrape every 6h, context refresh at 3am, digest at ${contentConfig.digestHour}:00 ${contentConfig.digestTimezone}`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Content Bot] Shutting down...');
  closeContentDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Content Bot] Shutting down...');
  closeContentDb();
  process.exit(0);
});
