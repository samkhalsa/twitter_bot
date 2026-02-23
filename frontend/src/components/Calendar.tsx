import { format, addDays, isSameDay, startOfDay } from 'date-fns';
import type { Post, PostTag } from '../types';
import { TAG_COLORS } from '../types';

interface CalendarProps {
  posts: Post[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

export function Calendar({ posts, selectedDate, onSelectDate }: CalendarProps) {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  const getPostsForDay = (date: Date) => {
    return posts.filter(post => {
      if (!post.scheduledAt) return false;
      return isSameDay(new Date(post.scheduledAt), date);
    });
  };

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const dayPosts = getPostsForDay(day);
        const isSelected = isSameDay(day, selectedDate);
        const isToday = isSameDay(day, today);

        return (
          <button
            key={day.toISOString()}
            onClick={() => onSelectDate(day)}
            className={`
              p-3 rounded-lg border transition-all min-h-[100px] flex flex-col
              ${isSelected
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'}
              ${isToday ? 'ring-2 ring-blue-500/50' : ''}
            `}
          >
            <div className="text-xs text-zinc-500 mb-1">
              {format(day, 'EEE')}
            </div>
            <div className={`text-lg font-semibold mb-2 ${isToday ? 'text-blue-400' : ''}`}>
              {format(day, 'd')}
            </div>
            <div className="flex-1 space-y-1">
              {dayPosts.slice(0, 3).map((post) => (
                <div
                  key={post.id}
                  className={`text-xs px-1.5 py-0.5 rounded truncate border ${
                    post.tags[0] ? TAG_COLORS[post.tags[0] as PostTag] : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {post.content.slice(0, 20)}...
                </div>
              ))}
              {dayPosts.length > 3 && (
                <div className="text-xs text-zinc-500">
                  +{dayPosts.length - 3} more
                </div>
              )}
            </div>
            {dayPosts.length > 0 && (
              <div className="text-xs text-zinc-500 mt-1">
                {dayPosts.length} post{dayPosts.length !== 1 ? 's' : ''}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
