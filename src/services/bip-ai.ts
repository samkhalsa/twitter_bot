import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const REFERENCE_POSTS = `
These are example posts for TONE AND FORMAT ONLY. Do NOT copy their content — the tweet must be about the founder's product and what they shared about their day. Use these as style references:

Post 1:
week 15 of trying to hit 10k/mo in 10 weeks

progress:
- 4.9k MRR, 6.7k/mo revenue
- 590.3k views across all tiktok accounts (last 7 days)
- 39 avg downloads/day (last 7 days)

notes:
- first week where revenue + MRR has gone down :(
- got more views than last week but didn't affect downloads, might need to update my format to increase tiktok conversion rate
- conversion from download => paid is going down, from 22% to 13%, maybe it's time to add back free trial?
- lowk kinda wanna start working on other apps

onwards.

Post 2:
day 238 of building @trycandleapp, a game for connecting with the people you care about

we're open sourcing the candle confetti cannon for rn apps! we've found existing libraries weren't the best, so this may help if you're building celebratory screens, link below

happy to help if you have any questions

pair with someone today :)

Post 3:
we've now made another $144k in the last ~28 days. in the last month we turned off all tt ads and app store search ads, and switched to a 3 day trial only

after hitting stat sig, 3 day trial vs no trial, resulted in a +33% revenue uplift for the trial. the next experiment will be 3 day vs 7 day trial, will lyk the results in another month

this is day 314 of building @trycandleapp, a game for connecting with the people you care about

pair with someone today :)
`;

const SYSTEM_PROMPT = `You write build-in-public tweets. Write THREE versions.

Rules:
- lowercase only
- no hashtags, no emojis, no fluff
- write like you're texting a friend, not performing
- short. don't over-explain
- bullet points ok for shipping updates
- under 280 chars preferred, 500 max for update lists
- the tweet MUST be about the founder's product and their day — use reference posts for style/tone only, never copy their content

${REFERENCE_POSTS}

Return exactly:
1: [tweet]
---
2: [tweet]
---
3: [tweet]

Nothing else.`;

export interface GeneratedBipPosts {
  a: string;
  b: string;
  c: string;
}

export async function generateBipPost(
  dayNumber: number,
  account: string,
  productDesc: string,
  answers: {
    workingOn?: string;
    results?: string;
    launches?: string;
    other?: string;
  },
  instructions?: string
): Promise<GeneratedBipPosts> {
  let prompt = `day ${dayNumber} of building @${account} — ${productDesc}\n\n`;
  prompt += `what happened today:\n`;

  if (answers.workingOn) prompt += `- Working on: ${answers.workingOn}\n`;
  if (answers.results) prompt += `- Results/metrics: ${answers.results}\n`;
  if (answers.launches) prompt += `- Launches/updates: ${answers.launches}\n`;
  if (answers.other) prompt += `- Other: ${answers.other}\n`;

  if (instructions) {
    prompt += `\nAdditional instructions: ${instructions}`;
  }

  prompt += `\n\nWrite three tweet options:`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  const text = block.text.trim();
  const parts = text.split('---').map((p) => p.trim());

  const clean = (s: string) => s.replace(/^[123]:\s*/, '').trim();

  return {
    a: clean(parts[0] || ''),
    b: clean(parts[1] || ''),
    c: clean(parts[2] || ''),
  };
}
