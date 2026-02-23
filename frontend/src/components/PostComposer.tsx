import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Sparkles, Send, Save, Calendar, Loader2, Hash, X } from 'lucide-react';
import type { PostTag, Post } from '../types';
import { ALL_TAGS, TAG_COLORS } from '../types';

interface PostComposerProps {
  selectedDate: Date;
  onSaveDraft: (content: string, tags: string[]) => void;
  onSchedule: (content: string, scheduledAt: string, tags: string[]) => void;
  onPostNow: (content: string, tags: string[]) => void;
  editingPost?: Post | null;
  onCancelEdit?: () => void;
}

export function PostComposer({ selectedDate, onSaveDraft, onSchedule, onPostNow, editingPost, onCancelEdit }: PostComposerProps) {
  const [content, setContent] = useState('');
  const [selectedTags, setSelectedTags] = useState<PostTag[]>([]);
  const [scheduledTime, setScheduledTime] = useState('09:00');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiMode, setAiMode] = useState<'improve' | 'ideas' | 'hashtags' | null>(null);

  // Populate form when editing a post
  useEffect(() => {
    if (editingPost) {
      setContent(editingPost.content);
      setSelectedTags(editingPost.tags as PostTag[]);
      if (editingPost.scheduledAt) {
        const date = new Date(editingPost.scheduledAt);
        setScheduledTime(format(date, 'HH:mm'));
      }
    }
  }, [editingPost]);

  const charCount = content.length;
  const maxChars = 280;
  const isOverLimit = charCount > maxChars;

  const toggleTag = (tag: PostTag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const handleAiAssist = async (mode: 'improve' | 'ideas' | 'hashtags') => {
    setIsGenerating(true);
    setAiMode(mode);
    try {
      const response = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mode, tags: selectedTags }),
      });
      const data = await response.json();
      if (data.result) {
        if (mode === 'hashtags') {
          setContent(prev => prev + '\n\n' + data.result);
        } else {
          setContent(data.result);
        }
      }
    } catch (error) {
      console.error('AI assist error:', error);
    } finally {
      setIsGenerating(false);
      setAiMode(null);
    }
  };

  const handleSchedule = () => {
    const scheduledAt = new Date(selectedDate);
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    scheduledAt.setHours(hours, minutes, 0, 0);
    onSchedule(content, scheduledAt.toISOString(), selectedTags);
    setContent('');
    setSelectedTags([]);
  };

  const handleSaveDraft = () => {
    onSaveDraft(content, selectedTags);
    setContent('');
    setSelectedTags([]);
  };

  const handlePostNow = () => {
    onPostNow(content, selectedTags);
    setContent('');
    setSelectedTags([]);
  };

  const handleCancelEdit = () => {
    setContent('');
    setSelectedTags([]);
    setScheduledTime('09:00');
    onCancelEdit?.();
  };

  return (
    <div className={`bg-zinc-900 rounded-lg border p-4 ${editingPost ? 'border-yellow-500/50' : 'border-zinc-800'}`}>
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">
              {editingPost ? 'Editing Draft' : 'Compose Post'}
            </span>
            {editingPost && (
              <button
                onClick={handleCancelEdit}
                className="text-xs text-yellow-500 hover:text-yellow-400 flex items-center gap-1"
              >
                <X size={12} />
                Cancel
              </button>
            )}
          </div>
          <span className={`text-sm ${isOverLimit ? 'text-red-400' : 'text-zinc-500'}`}>
            {charCount}/{maxChars}
          </span>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind? Share your journey..."
          className="w-full h-32 bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Tags */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-2">
          <Hash size={14} className="text-zinc-500" />
          <span className="text-sm text-zinc-400">Tags</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`px-2 py-1 text-xs rounded border transition-all ${
                selectedTags.includes(tag)
                  ? TAG_COLORS[tag]
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* AI Assistance */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-purple-400" />
          <span className="text-sm text-zinc-400">AI Assist</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleAiAssist('ideas')}
            disabled={isGenerating}
            className="px-3 py-1.5 text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/30 disabled:opacity-50 flex items-center gap-1"
          >
            {isGenerating && aiMode === 'ideas' ? <Loader2 size={12} className="animate-spin" /> : null}
            Generate Ideas
          </button>
          <button
            onClick={() => handleAiAssist('improve')}
            disabled={isGenerating || !content}
            className="px-3 py-1.5 text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30 disabled:opacity-50 flex items-center gap-1"
          >
            {isGenerating && aiMode === 'improve' ? <Loader2 size={12} className="animate-spin" /> : null}
            Improve Draft
          </button>
          <button
            onClick={() => handleAiAssist('hashtags')}
            disabled={isGenerating || !content}
            className="px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/30 disabled:opacity-50 flex items-center gap-1"
          >
            {isGenerating && aiMode === 'hashtags' ? <Loader2 size={12} className="animate-spin" /> : null}
            Add Hashtags
          </button>
        </div>
      </div>

      {/* Schedule Time */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Calendar size={14} className="text-zinc-500" />
          <span className="text-sm text-zinc-400">
            Schedule for {format(selectedDate, 'MMM d, yyyy')}
          </span>
        </div>
        <input
          type="time"
          value={scheduledTime}
          onChange={(e) => setScheduledTime(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSaveDraft}
          disabled={!content}
          className="px-4 py-2 text-sm bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 disabled:opacity-50 flex items-center gap-2"
        >
          <Save size={16} />
          Save Draft
        </button>
        <button
          onClick={handleSchedule}
          disabled={!content || isOverLimit}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2"
        >
          <Calendar size={16} />
          Schedule
        </button>
        <button
          onClick={handlePostNow}
          disabled={!content || isOverLimit}
          className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50 flex items-center gap-2"
        >
          <Send size={16} />
          Post Now
        </button>
      </div>
    </div>
  );
}
