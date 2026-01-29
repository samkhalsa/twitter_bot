# Twitter Reply Bot

## Overview
Node.js/TypeScript bot that monitors Twitter accounts for new tweets, generates authentic replies using Claude API, and sends them via Telegram for approval before posting. Accounts are managed dynamically via Telegram bot commands.

## Tech Stack
- **Runtime**: Node.js + TypeScript (tsx)
- **Twitter Reading**: RapidAPI twitter241 (`twitter241.p.rapidapi.com`)
- **Twitter Posting**: Official X API v2 (`api.x.com/2/tweets`) with OAuth 1.0a
- **AI**: Claude API (`@anthropic-ai/sdk`, model: `claude-sonnet-4-20250514`)
- **Messaging**: Telegram Bot API (`node-telegram-bot-api`)
- **Database**: SQLite via `better-sqlite3`
- **Scheduler**: `node-cron`

## Project Structure
```
src/
├── index.ts              # Entry point: cron polling + Telegram bot setup
├── config.ts             # Environment config loader
├── db.ts                 # SQLite setup (tracked_accounts, pending_replies)
├── services/
│   ├── twitter.ts        # Twitter client (read via RapidAPI, post via X API v2)
│   ├── ai.ts             # Claude reply generation (with optional instructions)
│   └── telegram.ts       # Telegram bot: send messages, commands, approval flow
Dockerfile                # Multi-stage Node 20 build (handles better-sqlite3 native deps)
docker-compose.yml        # Single service with .env and persistent volume
.dockerignore             # Excludes node_modules, .env, .git, db files
```

## Key APIs

### Reading (RapidAPI twitter241)
- `GET /user?username=X` — resolve username to numeric user ID
- `GET /user-tweets?user=ID` — fetch user's tweets (requires numeric user ID)
- Host: `twitter241.p.rapidapi.com`
- Auth: `X-RapidAPI-Key` header

### Posting (Official X API v2)
- `POST https://api.x.com/2/tweets` — post tweet/reply
- Reply format: `{ "text": "...", "reply": { "in_reply_to_tweet_id": "..." } }`
- Auth: OAuth 1.0a (consumer key/secret + access token/secret)
- Rate limit: 17 tweets per 24 hours (free tier)

## Database Tables
- **tracked_accounts**: `id`, `username`, `last_tweet_id`, `added_at`
- **pending_replies**: `id`, `tweet_id`, `tweet_text`, `tweet_author`, `tweet_url`, `generated_reply`, `final_reply`, `status`, `created_at`, `resolved_at`
- Status values: `new`, `pending`, `approved`, `edited`, `rejected`, `posted`

## Commands
- `npm run dev` — run with hot reload
- `npm run start` — run production
- `npm run build` — type check with tsc
- `docker compose up -d --build` — build and run in Docker
- `docker compose down` — stop the container
- `docker compose logs -f` — tail container logs

## Telegram Commands
- `/help` — show all available commands
- `/start` — start automatic polling
- `/stop` — stop automatic polling
- `/poll` — run a one-off poll immediately (works even when polling is stopped)
- `/add username` — track a new account
- `/remove username` — stop tracking
- `/list` — show all tracked accounts
- `/status` — show bot stats (polling state, tracked accounts, pending/posted replies, last poll)
- `/fetch username` — fetch a user's latest tweet and generate a reply

### Reply Approval (plain text — only these patterns are accepted, anything else returns "command not understood")
- `1` — approve latest pending reply
- `1 #ID` — approve specific reply
- `2` — reject latest pending reply
- `2 #ID` — reject specific reply
- `#ID your text` — post custom reply for specific ID

### Regenerate Replies
- `/regen` — regenerate latest pending reply
- `/regen ID` or `/regen #ID` — regenerate specific reply
- `/regen make it funnier` — regenerate latest with instructions
- `/regen #ID be more sarcastic` — regenerate specific with instructions

## Key Implementation Details
- **User ID resolution**: twitter241 requires numeric user IDs for `/user-tweets`. The bot resolves usernames via `/user` endpoint and caches results in memory.
- **1-hour filter**: Polling only processes tweets from the last hour. The `/fetch` command skips this filter.
- **Latest only**: Each poll cycle only processes the most recent tweet per account.
- **Duplicate detection**: Tweets already in `pending_replies` are skipped.
- **AI prompt style**: Replies are lowercase, short, no hashtags/emojis — sounds like a real person, not a brand.
- **Auth error alerts**: Bot sends a Telegram alert when Twitter OAuth credentials fail (401/403) or rate limit is hit (429).
- **Single instance**: Only one bot instance can run at a time (Telegram polling conflict). Kill old instances before starting.
- **Mass add accounts**: Use SQLite directly: `sqlite3 bot.db "INSERT OR IGNORE INTO tracked_accounts (username) VALUES ('user1'), ('user2');"`

## Setup
1. Install deps: `npm install`
2. Copy `.env.example` to `.env` and fill in credentials
3. Create a Telegram bot via [@BotFather](https://t.me/BotFather) and get the token
4. Get your chat ID by messaging the bot and visiting `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Create an X developer account at [developer.x.com](https://developer.x.com), create a project + app, enable OAuth 1.0a with Read+Write permissions, generate keys
6. Run: `npm run dev`

## Docker
- SQLite database is persisted in a Docker volume (`bot-data`) mounted at `/app/data/`
- The `DB_PATH` env var controls the database location (defaults to `./bot.db` for local dev, set to `/app/data/bot.db` in Docker)
- `.env` file is loaded automatically by docker-compose

## Environment Variables
- `RAPIDAPI_KEY` — RapidAPI subscription key (must be subscribed to twitter241)
- `TWITTER_CONSUMER_KEY` — X API OAuth 1.0a consumer key
- `TWITTER_CONSUMER_SECRET` — X API OAuth 1.0a consumer secret
- `TWITTER_ACCESS_TOKEN` — X API OAuth 1.0a access token
- `TWITTER_ACCESS_TOKEN_SECRET` — X API OAuth 1.0a access token secret
- `ANTHROPIC_API_KEY` — Claude API key
- `TELEGRAM_BOT_TOKEN` — Telegram bot token from BotFather
- `TELEGRAM_CHAT_ID` — your Telegram chat ID
- `POLL_INTERVAL_MINUTES` — polling frequency (default 60)
- `DB_PATH` — SQLite database file path (default: `./bot.db`, Docker: `/app/data/bot.db`)
