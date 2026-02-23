import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Search,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  Play,
  Pause,
  Clock,
  Target,
  MessageSquare,
  TrendingUp,
  AlertCircle,
  Users,
} from 'lucide-react';
import type { SearchQuery, BotStatus, RepliedAuthor } from '../types';

interface SearchesPageProps {
  queries: SearchQuery[];
  repliedAuthors: RepliedAuthor[];
  status: BotStatus | null;
  onAddQuery: (query: string) => Promise<boolean>;
  onDeleteQuery: (id: number) => Promise<void>;
  onToggleQuery: (id: number, status: 'active' | 'paused') => Promise<void>;
  onTriggerSearch: () => Promise<void>;
  onToggleSearchPolling: (enable: boolean) => Promise<void>;
  onRefreshStatus: () => Promise<void>;
  onMarkFollowed: (id: number) => Promise<void>;
  onBatchFollow: (ids: number[]) => Promise<void>;
}

export function SearchesPage({
  queries,
  repliedAuthors,
  status,
  onAddQuery,
  onDeleteQuery,
  onToggleQuery,
  onTriggerSearch,
  onToggleSearchPolling,
  onRefreshStatus,
  onMarkFollowed,
  onBatchFollow,
}: SearchesPageProps) {
  const [newQuery, setNewQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  const [showFollows, setShowFollows] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuery.trim()) return;

    setIsAdding(true);
    setError('');
    try {
      await onAddQuery(newQuery.trim());
      setNewQuery('');
    } catch (err: any) {
      setError(err.message || 'Failed to add query');
    } finally {
      setIsAdding(false);
    }
  };

  const handleTriggerSearch = async () => {
    setIsSearching(true);
    try {
      await onTriggerSearch();
      await onRefreshStatus();
    } finally {
      setIsSearching(false);
    }
  };

  const unfollowedAuthors = repliedAuthors.filter((a) => !a.followedAt);

  const handleBatchFollow = async () => {
    const ids = unfollowedAuthors.map((a) => a.id);
    if (ids.length > 0) {
      await onBatchFollow(ids);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <Search size={16} />
            <span className="text-xs uppercase">Queries</span>
          </div>
          <p className="text-2xl font-bold text-white">{status?.searchQueryCount ?? queries.length}</p>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <Target size={16} />
            <span className="text-xs uppercase">Followers</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {status?.followerRange?.min ?? 50}-{status?.followerRange?.max ?? 200}
          </p>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <MessageSquare size={16} />
            <span className="text-xs uppercase">Search Replies</span>
          </div>
          <p className="text-2xl font-bold text-green-400">{status?.searchRepliesPosted ?? 0}</p>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <Clock size={16} />
            <span className="text-xs uppercase">Interval</span>
          </div>
          <p className="text-2xl font-bold text-white">{status?.searchIntervalMinutes ?? 30}m</p>
        </div>
      </div>

      {/* Search Polling Controls */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {status?.searchEnabled ? (
                <span className="flex items-center gap-2 text-green-400">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Search Active
                </span>
              ) : (
                <span className="flex items-center gap-2 text-red-400">
                  <span className="w-2 h-2 bg-red-400 rounded-full" />
                  Search Stopped
                </span>
              )}
            </div>

            {status?.lastSearchTime && (
              <span className="text-sm text-zinc-500">
                Last search: {formatDistanceToNow(new Date(status.lastSearchTime), { addSuffix: true })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerSearch}
              disabled={isSearching}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
            >
              {isSearching ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Search Now
            </button>

            <button
              onClick={() => onToggleSearchPolling(!status?.searchEnabled)}
              className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 ${
                status?.searchEnabled
                  ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                  : 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
              }`}
            >
              {status?.searchEnabled ? (
                <>
                  <Pause size={16} />
                  Stop
                </>
              ) : (
                <>
                  <Play size={16} />
                  Start
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Add Query Form */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-300 mb-4">Add Search Query</h2>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newQuery}
            onChange={(e) => setNewQuery(e.target.value)}
            placeholder='e.g. "building in public", "just shipped"...'
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!newQuery.trim() || isAdding}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
          >
            {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Add
          </button>
        </form>
        {error && (
          <p className="text-red-400 text-sm mt-2 flex items-center gap-1">
            <AlertCircle size={14} />
            {error}
          </p>
        )}
      </div>

      {/* Queries List */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-300 mb-4">
          Search Queries ({queries.length})
        </h2>

        {queries.length === 0 ? (
          <p className="text-zinc-500 text-center py-8">
            No search queries yet. Add some above to start discovering tweets!
          </p>
        ) : (
          <div className="space-y-2">
            {queries.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-4 py-3 group hover:bg-zinc-800"
              >
                <div className="flex items-center gap-3 flex-1">
                  <button
                    onClick={() => onToggleQuery(q.id, q.status === 'active' ? 'paused' : 'active')}
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      q.status === 'active' ? 'bg-green-400' : 'bg-zinc-500'
                    }`}
                    title={q.status === 'active' ? 'Click to pause' : 'Click to activate'}
                  />
                  <div className="flex-1">
                    <span className="text-white">"{q.query}"</span>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-zinc-500">
                        <TrendingUp size={10} className="inline mr-1" />
                        {q.hits} hits
                      </span>
                      <span className="text-xs text-zinc-500">
                        <MessageSquare size={10} className="inline mr-1" />
                        {q.repliesSent} replies
                      </span>
                      {q.lastSearchedAt && (
                        <span className="text-xs text-zinc-500">
                          <Clock size={10} className="inline mr-1" />
                          {formatDistanceToNow(new Date(q.lastSearchedAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onDeleteQuery(q.id)}
                  className="text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Follow Tracking */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-zinc-300">
            Follow Tracking ({repliedAuthors.length} authors replied to)
          </h2>
          <div className="flex items-center gap-2">
            {unfollowedAuthors.length > 0 && (
              <button
                onClick={handleBatchFollow}
                className="px-3 py-1.5 bg-blue-600/20 text-blue-400 text-xs rounded-lg hover:bg-blue-600/30 flex items-center gap-1"
              >
                <Users size={12} />
                Mark all followed ({unfollowedAuthors.length})
              </button>
            )}
            <button
              onClick={() => setShowFollows(!showFollows)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              {showFollows ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {showFollows && (
          repliedAuthors.length === 0 ? (
            <p className="text-zinc-500 text-center py-4 text-sm">
              No replies sent yet. Authors you reply to will appear here.
            </p>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {repliedAuthors.map((author) => (
                <div
                  key={author.id}
                  className="flex items-center justify-between bg-zinc-800/30 rounded-lg px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <a
                      href={`https://x.com/${author.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:text-blue-400"
                    >
                      @{author.username}
                    </a>
                    {author.followerCount !== null && (
                      <span className="text-xs text-zinc-500">
                        {author.followerCount} followers
                      </span>
                    )}
                    {author.sourceQuery && (
                      <span className="text-xs text-zinc-600">
                        via "{author.sourceQuery}"
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {author.followedAt ? (
                      <span className="text-xs text-green-500">Followed</span>
                    ) : (
                      <button
                        onClick={() => onMarkFollowed(author.id)}
                        className="text-xs text-zinc-500 hover:text-blue-400"
                      >
                        Mark followed
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
