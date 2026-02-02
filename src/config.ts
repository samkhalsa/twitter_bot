import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
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
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  port: parseInt(process.env.PORT || '3000', 10),
  pollIntervalMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES || '60', 10),
  bip: {
    telegramBotToken: process.env.BIP_TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.BIP_TELEGRAM_CHAT_ID || '',
  },
};
