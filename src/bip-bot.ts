import { getDb, closeDb } from './db';
import cron from 'node-cron';

// Initialize database (creates tables if needed)
getDb();
console.log('[BIP Bot] Database initialized.');

// Import telegram service — this starts the bot polling
import { bipBot, startBipFlow } from './services/bip-telegram';

// Evening cron — trigger BIP prompt at 8 PM daily
const BIP_CRON = process.env.BIP_CRON || '0 20 * * *';
cron.schedule(BIP_CRON, () => {
  console.log('[BIP Bot] Evening cron triggered.');
  startBipFlow();
});

console.log('[BIP Bot] Build-in-Public bot is running.');
console.log(`[BIP Bot] Evening prompt scheduled: ${BIP_CRON}`);
console.log('[BIP Bot] Send /bip in Telegram to start manually.');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[BIP Bot] Shutting down...');
  bipBot.stopPolling();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bipBot.stopPolling();
  closeDb();
  process.exit(0);
});
