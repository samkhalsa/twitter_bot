import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { getDb } from '../db';
import { generateBipPost, GeneratedBipPosts } from './bip-ai';
import { postTweet } from './twitter';

const bot = new TelegramBot(config.bip.telegramBotToken, { polling: true });
const CHAT_ID = config.bip.telegramChatId;

console.log(`[BIP Telegram] Chat ID configured: "${CHAT_ID}"`);

// Log all incoming messages for debugging
bot.on('message', (msg) => {
  console.log(`[BIP Telegram] Received message from chat ${msg.chat.id}: "${msg.text}"`);
});

// Conversation state
type ConvoState =
  | { phase: 'idle' }
  | { phase: 'collecting'; answers: Partial<Answers>; step: number }
  | { phase: 'approving'; postId: number };

interface Answers {
  workingOn: string;
  results: string;
  launches: string;
  other: string;
}

let state: ConvoState = { phase: 'idle' };

function send(text: string) {
  console.log(`[BIP Telegram] Sending message to ${CHAT_ID}: ${text.slice(0, 80)}...`);
  return bot.sendMessage(CHAT_ID, text, { parse_mode: 'HTML' }).catch((err: any) => {
    console.error('[BIP Telegram] Send failed:', err.message);
  });
}

function getConfig(key: string): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM bip_config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value || '';
}

function setConfig(key: string, value: string) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO bip_config (key, value) VALUES (?, ?)').run(key, value);
}

const PROMPTS = [
  '1. What did you test/work on today?',
  '2. Any meaningful results or metrics?',
  '3. Any launches or updates to share?',
  '4. Anything else? (or "skip")',
];

function startBipFlow() {
  const dayNumber = getConfig('day_number') || '1';
  state = { phase: 'collecting', answers: {}, step: 0 };

  send(
    `<b>Build in Public — Day ${dayNumber}</b>\n\n` +
      `Answer these prompts one at a time:\n\n` +
      PROMPTS.join('\n')
  );
}

function formatPostOptions(posts: GeneratedBipPosts, postId: number): string {
  return (
    `<b>BIP Post #${postId} — Pick one:</b>\n\n` +
    `<b>A:</b>\n${posts.a}\n\n` +
    `<b>B:</b>\n${posts.b}\n\n` +
    `<b>C:</b>\n${posts.c}\n\n` +
    `Reply: <b>a</b> / <b>b</b> / <b>c</b> to approve, <b>no</b> to reject, or type custom text to post instead`
  );
}

async function handleCollectedAnswers(answers: Partial<Answers>) {
  const dayNumber = parseInt(getConfig('day_number') || '1', 10);
  const account = getConfig('account') || 'penseum_';
  const productDesc = getConfig('product_desc') || '';

  await send('Generating post options...');

  const posts = await generateBipPost(dayNumber, account, productDesc, {
    workingOn: answers.workingOn,
    results: answers.results,
    launches: answers.launches,
    other: answers.other,
  });

  const db = getDb();
  const result = db
    .prepare(
      'INSERT INTO bip_posts (day_number, answers, generated_post, status) VALUES (?, ?, ?, ?)'
    )
    .run(dayNumber, JSON.stringify(answers), JSON.stringify(posts), 'pending');

  const postId = result.lastInsertRowid as number;
  state = { phase: 'approving', postId };

  await send(formatPostOptions(posts, postId));
}

async function handleApproval(text: string) {
  if (state.phase !== 'approving') return;

  const db = getDb();
  const row = db.prepare('SELECT * FROM bip_posts WHERE id = ?').get(state.postId) as any;
  if (!row) {
    await send('Post not found.');
    state = { phase: 'idle' };
    return;
  }

  const posts: GeneratedBipPosts = JSON.parse(row.generated_post);
  const lower = text.trim().toLowerCase();

  let tweetText: string | null = null;

  if (lower === 'a') tweetText = posts.a;
  else if (lower === 'b') tweetText = posts.b;
  else if (lower === 'c') tweetText = posts.c;
  else if (lower === 'no') {
    db.prepare('UPDATE bip_posts SET status = ? WHERE id = ?').run('rejected', row.id);
    state = { phase: 'idle' };
    await send('Rejected. Send /bip to start again.');
    return;
  } else {
    // Custom text — post as-is
    tweetText = text.trim();
  }

  if (tweetText) {
    const tweetId = await postTweet(tweetText);
    if (tweetId) {
      const account = getConfig('account') || 'penseum_';
      db.prepare(
        'UPDATE bip_posts SET status = ?, final_post = ?, posted_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run('posted', tweetText, row.id);

      // Increment day number
      const currentDay = parseInt(getConfig('day_number') || '1', 10);
      setConfig('day_number', String(currentDay + 1));

      await send(
        `Posted! https://x.com/${account}/status/${tweetId}\n\nDay ${currentDay + 1} tomorrow.`
      );
    } else {
      await send('Failed to post tweet. Try again or check Twitter credentials.');
    }
    state = { phase: 'idle' };
  }
}

// --- Commands ---

bot.onText(/\/bip(@\w+)?$/, (msg) => {
  console.log(`[BIP Telegram] /bip command received, chat check: ${String(msg.chat.id)} === ${CHAT_ID}`);
  if (String(msg.chat.id) !== CHAT_ID) return;
  startBipFlow();
});

bot.onText(/\/bipday\s+(\d+)/, (msg, match) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  const day = match![1];
  setConfig('day_number', day);
  send(`Day number set to ${day}.`);
});

bot.onText(/\/bipdesc\s+(.+)/, (msg, match) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  const desc = match![1];
  setConfig('product_desc', desc);
  send(`Product description updated.`);
});

bot.onText(/\/bipstatus/, (msg) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  const db = getDb();
  const dayNumber = getConfig('day_number');
  const account = getConfig('account');
  const desc = getConfig('product_desc');
  const posted = db.prepare('SELECT COUNT(*) as c FROM bip_posts WHERE status = ?').get('posted') as any;
  const pending = db.prepare('SELECT COUNT(*) as c FROM bip_posts WHERE status = ?').get('pending') as any;

  send(
    `<b>BIP Status</b>\n` +
      `Day: ${dayNumber}\n` +
      `Account: @${account}\n` +
      `Description: ${desc}\n` +
      `Posted: ${posted.c} | Pending: ${pending.c}\n` +
      `State: ${state.phase}`
  );
});

bot.onText(/\/help/, (msg) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  send(
    `<b>Build in Public Bot</b>\n\n` +
      `/bip — start daily post flow\n` +
      `/bipday N — set day number\n` +
      `/bipdesc text — set product description\n` +
      `/bipstatus — show current status\n` +
      `/help — this message`
  );
});

// --- Message handler for conversation flow ---

bot.on('message', (msg) => {
  if (String(msg.chat.id) !== CHAT_ID) return;
  if (!msg.text || msg.text.startsWith('/')) return;

  const text = msg.text.trim();

  if (state.phase === 'collecting') {
    const step = state.step;
    const val = text.toLowerCase() === 'skip' ? '' : text;

    if (step === 0) state.answers.workingOn = val;
    else if (step === 1) state.answers.results = val;
    else if (step === 2) state.answers.launches = val;
    else if (step === 3) state.answers.other = val;

    state.step++;

    if (state.step < 4) {
      send(PROMPTS[state.step]);
    } else {
      handleCollectedAnswers(state.answers).catch((err) => {
        console.error('[BIP] Error generating post:', err);
        send('Error generating post. Try /bip again.');
        state = { phase: 'idle' };
      });
    }
    return;
  }

  if (state.phase === 'approving') {
    handleApproval(text).catch((err) => {
      console.error('[BIP] Error handling approval:', err);
      send('Error. Try /bip again.');
      state = { phase: 'idle' };
    });
    return;
  }
});

export { bot as bipBot, startBipFlow };
