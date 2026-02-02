# Twitter Bot Monorepo

This repo contains two independent Telegram bots that share the same database and Twitter credentials.

---

## Bot 1: Twitter Reply Bot

### Overview
Monitors Twitter accounts for new tweets, generates authentic replies using Claude API, and sends them via Telegram for approval before posting.

### Entry Point
`npm run dev` — runs `src/index.ts`

### Telegram Commands
- `/help` — show all available commands
- `/start` — start automatic polling
- `/stop` — stop automatic polling
- `/poll` — run a one-off poll immediately
- `/add username` — track a new account
- `/remove username` — stop tracking
- `/list` — show all tracked accounts
- `/status` — show bot stats
- `/fetch username` — fetch a user's latest tweet and generate a reply
- `/regen` — regenerate latest pending reply
- `/regen #ID instructions` — regenerate specific reply with instructions

### Reply Approval
- `1` / `1a` / `1b` / `1c` — approve latest (with option)
- `1 #ID` — approve specific reply
- `2` / `2 #ID` — reject
- `#ID your text` — post custom reply

### Environment Variables
- `TELEGRAM_BOT_TOKEN` — Reply bot's Telegram token
- `TELEGRAM_CHAT_ID` — your Telegram chat ID

---

## Bot 2: Build-in-Public Bot

### Overview
Separate Telegram bot that prompts you about your day's work, then generates a build-in-public tweet for @penseum_ in the style of @alex_ruber. Posts as a standalone tweet (not a reply).

### Entry Point
- `npm run bip` — run once
- `npm run bip:dev` — run with hot reload

### Flow
1. `/bip` command (or evening cron) sends prompts asking about your day
2. You answer 4 questions one at a time (or type "skip")
3. Claude generates 3 tweet options styled like @alex_ruber's build-in-public posts
4. You approve (a/b/c), reject (no), or send custom text
5. Bot posts the tweet and increments the day counter

### Telegram Commands
- `/bip` — start the daily build-in-public flow
- `/bipday N` — set the current day number
- `/bipdesc text` — update the product description
- `/bipstatus` — show current day, post counts, bot state
- `/help` — show all BIP bot commands

### Post Approval
- `a` / `b` / `c` — approve option A, B, or C
- `no` — reject and start over
- Any other text — post that as the tweet verbatim

### Database Tables
- **bip_config**: key-value store (`day_number`, `product_desc`, `account`)
- **bip_posts**: `id`, `day_number`, `answers` (JSON), `generated_post` (JSON), `final_post`, `status`, `created_at`, `posted_at`

### Environment Variables
- `BIP_TELEGRAM_BOT_TOKEN` — BIP bot's Telegram token (separate bot from BotFather)
- `BIP_TELEGRAM_CHAT_ID` — your Telegram chat ID
- `BIP_CRON` — cron expression for evening prompt (default: `0 20 * * *` = 8 PM)

### Setup
1. Create a new bot via [@BotFather](https://t.me/BotFather)
2. Add `BIP_TELEGRAM_BOT_TOKEN` and `BIP_TELEGRAM_CHAT_ID` to `.env`
3. Message the new bot to get your chat ID (same as your existing chat ID)
4. Run: `npm run bip:dev`
5. Send `/bip` to start

---

## Shared

### Tech Stack
- **Runtime**: Node.js + TypeScript (tsx)
- **Twitter Reading**: RapidAPI twitter241 (`twitter241.p.rapidapi.com`)
- **Twitter Posting**: Official X API v2 (`api.x.com/2/tweets`) with OAuth 1.0a
- **AI**: Claude API (`@anthropic-ai/sdk`, model: `claude-sonnet-4-20250514`)
- **Messaging**: Telegram Bot API (`node-telegram-bot-api`)
- **Database**: SQLite via `better-sqlite3`
- **Scheduler**: `node-cron`

### Project Structure
```
src/
├── index.ts              # Reply bot entry point
├── bip-bot.ts            # BIP bot entry point
├── config.ts             # Environment config loader
├── db.ts                 # SQLite setup (all tables)
├── services/
│   ├── twitter.ts        # Twitter client (read via RapidAPI, post via X API v2)
│   ├── ai.ts             # Claude reply generation
│   ├── telegram.ts       # Reply bot: Telegram commands + approval flow
│   ├── bip-ai.ts         # Claude BIP post generation (hardcoded style examples)
│   └── bip-telegram.ts   # BIP bot: Telegram commands + conversation flow
```

### Key APIs

#### Reading (RapidAPI twitter241)
- `GET /user?username=X` — resolve username to numeric user ID
- `GET /user-tweets?user=ID` — fetch user's tweets
- Auth: `X-RapidAPI-Key` header

#### Posting (Official X API v2)
- `POST https://api.x.com/2/tweets` — post tweet or reply
- Reply format: `{ "text": "...", "reply": { "in_reply_to_tweet_id": "..." } }`
- Standalone format: `{ "text": "..." }`
- Auth: OAuth 1.0a
- Rate limit: 17 tweets per 24 hours (free tier)

### Database Tables (shared SQLite file)
- **tracked_accounts**: `id`, `username`, `last_tweet_id`, `added_at`
- **pending_replies**: `id`, `tweet_id`, `tweet_text`, `tweet_author`, `tweet_url`, `generated_reply`, `final_reply`, `status`, `created_at`, `resolved_at`
- **bip_config**: `key`, `value`
- **bip_posts**: `id`, `day_number`, `answers`, `generated_post`, `final_post`, `status`, `created_at`, `posted_at`

### All Commands
- `npm run dev` — run reply bot with hot reload
- `npm run start` — run reply bot production
- `npm run build` — type check with tsc
- `npm run bip` — run BIP bot
- `npm run bip:dev` — run BIP bot with hot reload
- `docker compose up -d --build` — build and run in Docker
- `docker compose down` — stop containers
- `docker compose logs -f` — tail logs

### All Environment Variables
- `RAPIDAPI_KEY` — RapidAPI key (subscribed to twitter241)
- `TWITTER_CONSUMER_KEY` — X API OAuth 1.0a consumer key
- `TWITTER_CONSUMER_SECRET` — X API OAuth 1.0a consumer secret
- `TWITTER_ACCESS_TOKEN` — X API OAuth 1.0a access token
- `TWITTER_ACCESS_TOKEN_SECRET` — X API OAuth 1.0a access token secret
- `ANTHROPIC_API_KEY` — Claude API key
- `TELEGRAM_BOT_TOKEN` — Reply bot Telegram token
- `TELEGRAM_CHAT_ID` — your Telegram chat ID
- `BIP_TELEGRAM_BOT_TOKEN` — BIP bot Telegram token
- `BIP_TELEGRAM_CHAT_ID` — BIP bot chat ID
- `BIP_CRON` — evening prompt schedule (default: `0 20 * * *`)
- `POLL_INTERVAL_MINUTES` — reply bot polling frequency (default: 60)
- `DB_PATH` — SQLite file path (default: `./bot.db`, Docker: `/app/data/bot.db`)

### Important Notes
- **Single instance per bot**: Each bot can only have one instance running (Telegram polling conflict). Kill old instances before starting.
- **Separate tokens required**: Each bot needs its own unique token from BotFather.
- **Both bots can run simultaneously** since they use different Telegram tokens.
- **Shared database**: Both bots read/write to the same SQLite file.
