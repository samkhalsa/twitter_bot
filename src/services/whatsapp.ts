import twilio from 'twilio';
import { config } from '../config';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export async function sendWhatsApp(message: string): Promise<boolean> {
  try {
    await client.messages.create({
      from: config.twilio.whatsappFrom,
      to: config.myWhatsappNumber,
      body: message,
    });
    return true;
  } catch (err) {
    console.error('[WhatsApp] Failed to send message:', err);
    return false;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatApprovalMessage(
  tweetAuthor: string,
  tweetText: string,
  generatedReply: string,
  pendingId: number,
  createdAt?: string,
  tweetUrl?: string
): string {
  const postedAgo = createdAt ? ` (${timeAgo(createdAt)})` : '';
  return [
    `🐦 New tweet from @${tweetAuthor}${postedAgo}:`,
    `"${tweetText}"`,
    tweetUrl ? `🔗 ${tweetUrl}` : '',
    ``,
    `💬 Suggested reply:`,
    `"${generatedReply}"`,
    ``,
    `[ID: ${pendingId}]`,
    `Reply with:`,
    `• 1 — Approve & post`,
    `• 2 — Reject`,
    `• Or send your edited reply text`,
  ].join('\n');
}
