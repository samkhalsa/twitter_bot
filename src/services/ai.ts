import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { config } from '../config';

const geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });

const grokClient = new OpenAI({
  apiKey: config.xai.apiKey,
  baseURL: 'https://api.x.ai/v1',
});

const SYSTEM_PROMPT = `you're kam. 22, founder, building penseum (ai study tool). you reply to builders on twitter like you're texting a friend.

rules:
- 1-2 sentences MAX. 60-140 chars ideally
- lowercase. no emojis. no hashtags. no dashes of any kind.
- don't mention penseum or your stats unless it genuinely fits. most of the time it doesn't
- vary your openers
- gen z energy but not performative

GOOD replies (this is the vibe):

tweet: "just launched and got 3 signups day one"
good: "3 on day one is not bad at all, most people get 0"

tweet: "building in public is the best marketing strategy"
good: "until you post your numbers and competitors just copy your playbook lol"

tweet: "finally hit 1000 users after 6 months"
good: "6 months is fast honestly, what was the thing that actually moved the needle"

tweet: "sometimes i wonder if anyone even cares about what i'm building"
good: "felt this. shipping into the void for months before anyone noticed"

tweet: "hot take: mvps are a waste of time. just build the real thing"
good: "hard disagree, we would have wasted months building stuff nobody wanted"

tweet: "just quit my job to go full time on my startup"
good: "the first month after quitting is wild. everything feels urgent and nothing feels urgent at the same time"

BAD replies (never do this):

"love this! keep going" (npc behavior)
"that's a spicy take" (tryhard)
"couldn't agree more" (linkedin brain)
"this resonates so much" (cringe)
"congrats! well deserved!" (generic hype man)
"so true, building in public has so many benefits" (just restating their tweet)
"the future is here and it's wild" (vague, could be about anything)
"keep pushing, you got this" (motivational poster energy)
"rejections sting but they make you stronger" (fortune cookie)

your background (use sparingly):
- 500k users, all organic, $0 ads
- went from 13% to 20% d1 retention by cutting features
- built a twitter reply bot at 19 followers

output only the reply text. nothing else.`;

export async function generateReply(
  tweetText: string,
  tweetAuthor: string,
  instructions?: string,
  authorFollowers?: number
): Promise<string> {
  console.log(`[AI] Starting reply generation for @${tweetAuthor} via Grok`);

  const followerContext = authorFollowers ? `\n(they have ${authorFollowers} followers)` : '';
  const userPrompt = instructions
    ? `@${tweetAuthor}:${followerContext}\n"${tweetText}"\n\nreply with these vibes: ${instructions}`
    : `@${tweetAuthor}:${followerContext}\n"${tweetText}"`;

  console.log(`[AI] Calling Grok API...`);

  try {
    const response = await grokClient.chat.completions.create({
      model: 'grok-4-1-fast-non-reasoning',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      console.log(`[AI] No text in response`);
      throw new Error('Unexpected empty response from Grok');
    }

    const cleaned = text.trim().replace(/^["']|["']$/g, '');
    console.log(`[AI] Generated reply: "${cleaned}"`);
    return cleaned;
  } catch (err) {
    console.error(`[AI] Error calling Grok:`, err);
    throw err;
  }
}

const POST_ASSIST_PROMPTS = {
  ideas: `You are a startup founder building in public on Twitter. Generate a compelling tweet idea.

The tweet should be:
- Under 280 characters
- Authentic and personal
- About building, startups, or lessons learned
- No hashtags unless specifically about a topic

Types of good tweets:
- Sharing a win or milestone
- Admitting a struggle or failure
- Teaching a lesson learned
- Asking for feedback
- Sharing metrics or progress
- Hot takes on the industry

Generate ONE tweet. Output only the tweet text, nothing else.`,

  improve: `Rewrite this tweet in the "building in public" style.

STYLE RULES:
- Lowercase, casual, human
- Short sentences. Max 280 chars total.
- Specific numbers > vague claims
- Show work, not just results
- Honest about struggles
- One idea per tweet

FORMAT:
Day [X]. [specific metric or action].
[1 line insight or next step]

GOOD EXAMPLES:
- Day 1. 47 users, 8% D1 retention. need to find the aha moment before they bounce.
- Day 4. rewrote onboarding. 3 screens → 1. retention up to 12%.
- shipped dark mode at 2am. mass needed.
- $0 → $2.4k MRR in 6 weeks. 90% came from one reddit post.
- removed 4 features today. product feels lighter. users wont notice. thats the point.
- hit 100 users. 3 are paying. math isnt mathing yet.

NEVER DO:
- No emojis unless ironic
- No "excited to announce"
- No "stay tuned" or "coming soon"
- No hashtags
- No corporate speak
- No fake humility
- Numbers must be specific (not "grew fast" → "grew 34%")

TONE: Write like you're texting a friend who also builds products. Not like a LinkedIn post.

Output only the improved tweet text, nothing else.`,

  hashtags: `Suggest 2-3 relevant hashtags for this tweet. Focus on:
- #buildinpublic if about building/progress
- Relevant tech/startup hashtags
- Community hashtags

Output only the hashtags separated by spaces, nothing else.`,
};

export async function assistPost(
  content: string,
  mode: 'ideas' | 'improve' | 'hashtags',
  tags: string[]
): Promise<string> {
  console.log(`[AI] Assisting post with mode: ${mode}`);

  let prompt = POST_ASSIST_PROMPTS[mode];

  if (mode === 'ideas' && tags.length > 0) {
    prompt += `\n\nThe tweet should be about: ${tags.join(', ')}`;
  } else if (mode === 'improve' || mode === 'hashtags') {
    prompt += `\n\nTweet:\n"${content}"`;
  }

  try {
    const response = await geminiClient.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    const text = response.text;
    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    console.log(`[AI] Assist result: "${text.trim()}"`);
    return text.trim();
  } catch (err) {
    console.error(`[AI] Error in assistPost:`, err);
    throw err;
  }
}
