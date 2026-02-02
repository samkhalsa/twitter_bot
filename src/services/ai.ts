import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `write THREE versions of a short twitter reply. lowercase only. no hashtags, no emojis. sound like a real person, not a brand. keep each under 200 characters. return them in this exact format:

1: [a useful thought — a take, a fact, or a question]
2: [a SHORT hilarious controversial comment about this situation that can easily start a debate and get attention]
3: [a SHORT hilarious comparison comment about this situation that can easily start a debate and get attention]

just return the three numbered replies, nothing else.`;

export interface GeneratedReplies {
  a: string; // useful thought
  b: string; // controversial
  c: string; // comparison
}

export async function generateReply(
  tweetText: string,
  tweetAuthor: string,
  instructions?: string,
  previousReplies?: GeneratedReplies
): Promise<GeneratedReplies> {
  let prompt: string;
  if (instructions && previousReplies) {
    prompt = `Tweet by @${tweetAuthor}:\n"${tweetText}"\n\nHere are the current reply options:\n1: ${previousReplies.a}\n2: ${previousReplies.b}\n3: ${previousReplies.c}\n\nRegenerate all three replies with these instructions: ${instructions}`;
  } else if (instructions) {
    prompt = `Tweet by @${tweetAuthor}:\n"${tweetText}"\n\nWrite replies with these instructions: ${instructions}`;
  } else if (previousReplies) {
    prompt = `Tweet by @${tweetAuthor}:\n"${tweetText}"\n\nHere are the current reply options:\n1: ${previousReplies.a}\n2: ${previousReplies.b}\n3: ${previousReplies.c}\n\nRegenerate all three with fresh takes:`;
  } else {
    prompt = `Tweet by @${tweetAuthor}:\n"${tweetText}"\n\nWrite replies:`;
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
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

  const text = block.text.trim();
  const lines = text.split('\n').filter((l) => l.trim());

  const extract = (prefix: string) => {
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.replace(prefix, '').trim() : '';
  };

  return {
    a: extract('1:'),
    b: extract('2:'),
    c: extract('3:'),
  };
}
