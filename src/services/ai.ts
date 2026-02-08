import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `reply to a tweet. be real, casual, direct. MAX 80 characters each. lowercase only, no hashtags/emojis.

4 options:
1: useful (a take or pushback)
2: contrarian (disagree, call out BS)
3: witty (sharp one-liner)
4: question (genuine curiosity)

4 numbered replies only. keep them SHORT.`;

export interface GeneratedReplies {
  a: string; // useful
  b: string; // contrarian
  c: string; // witty
  d: string; // question
}

export async function generateReply(
  tweetText: string,
  tweetAuthor: string,
  instructions?: string,
  previousReplies?: GeneratedReplies
): Promise<GeneratedReplies> {
  let prompt: string;
  if (instructions && previousReplies) {
    prompt = `Tweet by @${tweetAuthor}:\n"${tweetText}"\n\nHere are the current reply options:\n1: ${previousReplies.a}\n2: ${previousReplies.b}\n3: ${previousReplies.c}\n4: ${previousReplies.d}\n\nRegenerate all four replies with these instructions: ${instructions}`;
  } else if (instructions) {
    prompt = `Tweet by @${tweetAuthor}:\n"${tweetText}"\n\nWrite replies with these instructions: ${instructions}`;
  } else if (previousReplies) {
    prompt = `Tweet by @${tweetAuthor}:\n"${tweetText}"\n\nHere are the current reply options:\n1: ${previousReplies.a}\n2: ${previousReplies.b}\n3: ${previousReplies.c}\n4: ${previousReplies.d}\n\nRegenerate all four with fresh takes:`;
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
  console.log('[AI] Raw response:', text);
  const lines = text.split('\n').filter((l) => l.trim());

  const extract = (num: string) => {
    // Match variations: "1:", "1.", "1)", or just "1 " at start of line (with optional leading whitespace)
    const pattern = new RegExp(`^\\s*${num}[:.)]?\\s*(.*)$`, 'i');
    const line = lines.find((l) => pattern.test(l));
    if (line) {
      const match = line.match(pattern);
      return match ? match[1].trim() : '';
    }
    return '';
  };

  const result = {
    a: extract('1'),
    b: extract('2'),
    c: extract('3'),
    d: extract('4'),
  };
  console.log('[AI] Parsed replies:', result);
  return result;
}
