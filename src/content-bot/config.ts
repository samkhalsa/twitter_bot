import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const contentConfig = {
  rapidapi: {
    key: required('RAPIDAPI_KEY'),
host: process.env.RAPIDAPI_HOST || 'twitter241.p.rapidapi.com',
  },
  twitter: {
    consumerKey: required('TWITTER_CONSUMER_KEY'),
    consumerSecret: required('TWITTER_CONSUMER_SECRET'),
    accessToken: required('TWITTER_ACCESS_TOKEN'),
    accessTokenSecret: required('TWITTER_ACCESS_TOKEN_SECRET'),
  },
  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
  },
  telegram: {
    botToken: required('CONTENT_BOT_TELEGRAM_TOKEN'),
    chatId: required('TELEGRAM_CHAT_ID'),
  },
  digestHour: parseInt(process.env.DIGEST_HOUR || '9', 10),
  digestTimezone: process.env.DIGEST_TIMEZONE || 'America/Los_Angeles',
  dbPath: process.env.DB_PATH || './bot.db',
};
