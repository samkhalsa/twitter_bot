import { format } from 'date-fns';
import { Trash2, Edit2, Clock, CheckCircle, FileText } from 'lucide-react';
import type { Post, PostTag } from '../types';
import { TAG_COLORS } from '../types';

interface PostListProps {
  posts: Post[];
  title: string;
  onDelete: (id: number) => void;
  onEdit: (post: Post) => void;
}

export function PostList({ posts, title, onDelete, onEdit }: PostListProps) {
  if (posts.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">{title}</h3>
        <p className="text-zinc-500 text-sm">No posts yet</p>
      </div>
    );
  }

  const getStatusIcon = (status: Post['status']) => {
    switch (status) {
      case 'draft':
        return <FileText size={14} className="text-zinc-500" />;
      case 'scheduled':
        return <Clock size={14} className="text-blue-400" />;
      case 'posted':
        return <CheckCircle size={14} className="text-green-400" />;
    }
  };

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">{title}</h3>
      <div className="space-y-3">
        {posts.map((post) => (
          <div
            key={post.id}
            className="bg-zinc-800 rounded-lg p-3 border border-zinc-700"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                {getStatusIcon(post.status)}
                <span className="text-xs text-zinc-500">
                  {post.scheduledAt
                    ? format(new Date(post.scheduledAt), 'MMM d, h:mm a')
                    : 'Draft'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onEdit(post)}
                  className="p-1 text-zinc-500 hover:text-zinc-300"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => onDelete(post.id)}
                  className="p-1 text-zinc-500 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap mb-2">
              {post.content}
            </p>
            {post.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`px-1.5 py-0.5 text-xs rounded border ${
                      TAG_COLORS[tag as PostTag] || 'bg-zinc-700 text-zinc-400'
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
