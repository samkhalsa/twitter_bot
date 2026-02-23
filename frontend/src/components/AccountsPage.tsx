import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Users,
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Play,
  Pause,
  Clock,
  MessageSquare,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import type { TrackedAccount, BotStatus } from '../types';

interface AccountsPageProps {
  accounts: TrackedAccount[];
  status: BotStatus | null;
  onAdd: (username: string) => Promise<boolean>;
  onDelete: (id: number) => Promise<void>;
  onTriggerPoll: () => Promise<void>;
  onTogglePolling: (enable: boolean) => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}

export function AccountsPage({
  accounts,
  status,
  onAdd,
  onDelete,
  onTriggerPoll,
  onTogglePolling,
  onRefreshStatus,
}: AccountsPageProps) {
  const [newUsername, setNewUsername] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;

    setIsAdding(true);
    setError('');

    try {
      const success = await onAdd(newUsername.trim());
      if (success) {
        setNewUsername('');
      } else {
        setError('Failed to add account');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add account');
    } finally {
      setIsAdding(false);
    }
  };

  const handleTriggerPoll = async () => {
    setIsPolling(true);
    try {
      await onTriggerPoll();
      await onRefreshStatus();
    } finally {
      setIsPolling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <Users size={16} />
            <span className="text-xs uppercase">Tracked</span>
          </div>
          <p className="text-2xl font-bold text-white">{status?.accountCount ?? accounts.length}</p>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <MessageSquare size={16} />
            <span className="text-xs uppercase">Pending</span>
          </div>
          <p className="text-2xl font-bold text-yellow-400">{status?.pendingReplies ?? 0}</p>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <CheckCircle size={16} />
            <span className="text-xs uppercase">Posted</span>
          </div>
          <p className="text-2xl font-bold text-green-400">{status?.postedReplies ?? 0}</p>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <Clock size={16} />
            <span className="text-xs uppercase">Interval</span>
          </div>
          <p className="text-2xl font-bold text-white">{status?.pollIntervalMinutes ?? 60}m</p>
        </div>
      </div>

      {/* Polling Status & Controls */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {status?.pollingEnabled ? (
                <span className="flex items-center gap-2 text-green-400">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Polling Active
                </span>
              ) : (
                <span className="flex items-center gap-2 text-red-400">
                  <span className="w-2 h-2 bg-red-400 rounded-full" />
                  Polling Stopped
                </span>
              )}
            </div>

            {status?.lastPollTime && (
              <span className="text-sm text-zinc-500">
                Last poll: {formatDistanceToNow(new Date(status.lastPollTime), { addSuffix: true })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerPoll}
              disabled={isPolling}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
            >
              {isPolling ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Poll Now
            </button>

            <button
              onClick={() => onTogglePolling(!status?.pollingEnabled)}
              className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 ${
                status?.pollingEnabled
                  ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                  : 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
              }`}
            >
              {status?.pollingEnabled ? (
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

      {/* Add Account Form */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-300 mb-4">Add Account</h2>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="Enter Twitter username..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!newUsername.trim() || isAdding}
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

      {/* Accounts List */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-300 mb-4">
          Tracked Accounts ({accounts.length})
        </h2>

        {accounts.length === 0 ? (
          <p className="text-zinc-500 text-center py-8">
            No accounts tracked yet. Add some above!
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-4 py-3 group hover:bg-zinc-800"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-zinc-700 rounded-full flex items-center justify-center text-xs text-zinc-400">
                    {account.username.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <a
                      href={`https://x.com/${account.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:text-blue-400 flex items-center gap-1"
                    >
                      @{account.username}
                      <ExternalLink size={12} className="opacity-50" />
                    </a>
                    {account.lastTweetId && (
                      <p className="text-xs text-zinc-500">Has been polled</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onDelete(account.id)}
                  className="text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
