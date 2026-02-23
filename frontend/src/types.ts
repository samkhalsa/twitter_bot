export interface Post {
  id: number;
  content: string;
  scheduledAt: string | null;
  tags: string[];
  status: 'draft' | 'scheduled' | 'posted';
  createdAt: string;
  postedAt: string | null;
}

export interface TrackedAccount {
  id: number;
  username: string;
  lastTweetId: string | null;
  addedAt: string;
}

export interface BotStatus {
  pollingEnabled: boolean;
  pollIntervalMinutes: number;
  lastPollTime: string | null;
  accountCount: number;
  pendingReplies: number;
  postedReplies: number;
  searchEnabled: boolean;
  searchIntervalMinutes: number;
  lastSearchTime: string | null;
  searchQueryCount: number;
  searchRepliesPosted: number;
  followerRange: { min: number; max: number };
}

export interface SearchQuery {
  id: number;
  query: string;
  status: 'active' | 'paused';
  lastSearchedAt: string | null;
  hits: number;
  repliesSent: number;
  followBacks: number;
  createdAt: string;
}

export interface RepliedAuthor {
  id: number;
  username: string;
  followerCount: number | null;
  sourceQuery: string | null;
  followedAt: string | null;
  followedBack: number;
  checkedFollowBackAt: string | null;
  createdAt: string;
  totalReplies: number;
}

export type PostTag = 'milestone' | 'struggle' | 'learning' | 'metrics' | 'update' | 'ask';

export const TAG_COLORS: Record<PostTag, string> = {
  milestone: 'bg-green-500/20 text-green-400 border-green-500/30',
  struggle: 'bg-red-500/20 text-red-400 border-red-500/30',
  learning: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  metrics: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  update: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ask: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

export const ALL_TAGS: PostTag[] = ['milestone', 'struggle', 'learning', 'metrics', 'update', 'ask'];
