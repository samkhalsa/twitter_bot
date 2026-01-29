import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `write a short twitter reply. lowercase only. no hashtags, no emojis. sound like a real person, not a brand. add one useful thought — a take, a fact, or a question. keep it under 200 characters. just return the reply text.`;

export async function generateReply(
  tweetText: string,
  tweetAuthor: string,
  instructions?: string
): Promise<string> {
  const prompt = instructions
    ? `Tweet by @${tweetAuthor}:\n"${tweetText}"\n\nWrite a reply with these instructions: ${instructions}`
    : `Tweet by @${tweetAuthor}:\n"${tweetText}"\n\nWrite a reply:`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  return block.text.trim();
}
