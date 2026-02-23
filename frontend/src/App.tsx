import { useState, useEffect } from 'react';
import { Calendar } from './components/Calendar';
import { PostComposer } from './components/PostComposer';
import { PostList } from './components/PostList';
import { AccountsPage } from './components/AccountsPage';
import { SearchesPage } from './components/SearchesPage';
import { Login } from './components/Login';
import type { Post, TrackedAccount, BotStatus, SearchQuery, RepliedAuthor } from './types';
import { Twitter, LogOut, PenSquare, Users, Search } from 'lucide-react';

type Tab = 'planner' | 'accounts' | 'searches';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('planner');
  const [posts, setPosts] = useState<Post[]>([]);
  const [accounts, setAccounts] = useState<TrackedAccount[]>([]);
  const [searchQueries, setSearchQueries] = useState<SearchQuery[]>([]);
  const [repliedAuthors, setRepliedAuthors] = useState<RepliedAuthor[]>([]);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchPosts();
      fetchAccounts();
      fetchSearchQueries();
      fetchRepliedAuthors();
      fetchStatus();
    }
  }, [isAuthenticated]);

  // Refresh status when switching tabs
  useEffect(() => {
    if (isAuthenticated && (activeTab === 'accounts' || activeTab === 'searches')) {
      fetchStatus();
      if (activeTab === 'searches') {
        fetchSearchQueries();
        fetchRepliedAuthors();
      }
    }
  }, [activeTab, isAuthenticated]);

  const checkAuth = async () => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        const response = await fetch('/api/auth/verify', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem('auth_token');
        }
      } catch {
        localStorage.removeItem('auth_token');
      }
    }
    setCheckingAuth(false);
  };

  const handleLogin = async (password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        const { token } = await response.json();
        localStorage.setItem('auth_token', token);
        setIsAuthenticated(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    setIsAuthenticated(false);
    setPosts([]);
    setAccounts([]);
    setBotStatus(null);
  };

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setBotStatus(data);
    } catch (error) {
      console.error('Error fetching status:', error);
    }
  };

  const fetchAccounts = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/accounts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setAccounts(data);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const handleAddAccount = async (username: string): Promise<boolean> => {
    const token = localStorage.getItem('auth_token');
    try {
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username }),
      });
      if (response.ok) {
        const newAccount = await response.json();
        setAccounts(prev => [...prev, newAccount].sort((a, b) => a.username.localeCompare(b.username)));
        return true;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add account');
      }
    } catch (error: any) {
      console.error('Error adding account:', error);
      throw error;
    }
  };

  const handleDeleteAccount = async (id: number) => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch(`/api/accounts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setAccounts(prev => prev.filter(a => a.id !== id));
    } catch (error) {
      console.error('Error deleting account:', error);
    }
  };

  const handleTriggerPoll = async () => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch('/api/poll', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      console.error('Error triggering poll:', error);
    }
  };

  const handleTogglePolling = async (enable: boolean) => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch(`/api/polling/${enable ? 'start' : 'stop'}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchStatus();
    } catch (error) {
      console.error('Error toggling polling:', error);
    }
  };

  // --- Search Queries ---

  const fetchSearchQueries = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/searches', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setSearchQueries(data);
    } catch (error) {
      console.error('Error fetching search queries:', error);
    }
  };

  const fetchRepliedAuthors = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/follows', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setRepliedAuthors(data);
    } catch (error) {
      console.error('Error fetching replied authors:', error);
    }
  };

  const handleAddSearchQuery = async (query: string): Promise<boolean> => {
    const token = localStorage.getItem('auth_token');
    try {
      const response = await fetch('/api/searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
      });
      if (response.ok) {
        const newQuery = await response.json();
        setSearchQueries(prev => [newQuery, ...prev]);
        return true;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add query');
      }
    } catch (error: any) {
      console.error('Error adding search query:', error);
      throw error;
    }
  };

  const handleDeleteSearchQuery = async (id: number) => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch(`/api/searches/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setSearchQueries(prev => prev.filter(q => q.id !== id));
    } catch (error) {
      console.error('Error deleting search query:', error);
    }
  };

  const handleToggleSearchQuery = async (id: number, status: 'active' | 'paused') => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch(`/api/searches/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      setSearchQueries(prev => prev.map(q => q.id === id ? { ...q, status } : q));
    } catch (error) {
      console.error('Error toggling search query:', error);
    }
  };

  const handleTriggerSearch = async () => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch('/api/search/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchSearchQueries();
    } catch (error) {
      console.error('Error triggering search:', error);
    }
  };

  const handleToggleSearchPolling = async (enable: boolean) => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch(`/api/search/${enable ? 'start' : 'stop'}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchStatus();
    } catch (error) {
      console.error('Error toggling search polling:', error);
    }
  };

  const handleMarkFollowed = async (id: number) => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch(`/api/follows/${id}/mark-followed`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setRepliedAuthors(prev => prev.map(a => a.id === id ? { ...a, followedAt: new Date().toISOString() } : a));
    } catch (error) {
      console.error('Error marking followed:', error);
    }
  };

  const handleBatchFollow = async (ids: number[]) => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch('/api/follows/batch-follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
      setRepliedAuthors(prev => prev.map(a => ids.includes(a.id) ? { ...a, followedAt: new Date().toISOString() } : a));
    } catch (error) {
      console.error('Error batch following:', error);
    }
  };

  const fetchPosts = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/posts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setPosts(data);
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = async (content: string, tags: string[]) => {
    const token = localStorage.getItem('auth_token');
    try {
      if (editingPost) {
        const response = await fetch(`/api/posts/${editingPost.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ content, tags, status: 'draft' }),
        });
        const updatedPost = await response.json();
        setPosts(prev => prev.map(p => p.id === editingPost.id ? updatedPost : p));
        setEditingPost(null);
      } else {
        const response = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ content, tags, status: 'draft' }),
        });
        const newPost = await response.json();
        setPosts(prev => [newPost, ...prev]);
      }
    } catch (error) {
      console.error('Error saving draft:', error);
    }
  };

  const handleSchedule = async (content: string, scheduledAt: string, tags: string[]) => {
    const token = localStorage.getItem('auth_token');
    try {
      if (editingPost) {
        const response = await fetch(`/api/posts/${editingPost.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ content, tags, scheduledAt, status: 'scheduled' }),
        });
        const updatedPost = await response.json();
        setPosts(prev => prev.map(p => p.id === editingPost.id ? updatedPost : p));
        setEditingPost(null);
      } else {
        const response = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ content, tags, scheduledAt, status: 'scheduled' }),
        });
        const newPost = await response.json();
        setPosts(prev => [newPost, ...prev]);
      }
    } catch (error) {
      console.error('Error scheduling post:', error);
    }
  };

  const handlePostNow = async (content: string, tags: string[]) => {
    const token = localStorage.getItem('auth_token');
    try {
      const response = await fetch('/api/posts/now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content, tags }),
      });
      const result = await response.json();
      if (result.success) {
        fetchPosts();
      }
    } catch (error) {
      console.error('Error posting:', error);
    }
  };

  const handleDelete = async (id: number) => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch(`/api/posts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setPosts(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      console.error('Error deleting post:', error);
    }
  };

  const handleEdit = (post: Post) => {
    setEditingPost(post);
    if (post.scheduledAt) {
      setSelectedDate(new Date(post.scheduledAt));
    }
  };

  const handleCancelEdit = () => {
    setEditingPost(null);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  const scheduledPosts = posts.filter(p => p.status === 'scheduled');
  const draftPosts = posts.filter(p => p.status === 'draft');
  const postedPosts = posts.filter(p => p.status === 'posted').slice(0, 5);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Twitter className="text-blue-400" size={28} />
            <h1 className="text-2xl font-bold">Content Planner</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500">Building in Public</span>
            <button
              onClick={handleLogout}
              className="text-zinc-500 hover:text-zinc-300 flex items-center gap-1 text-sm"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-zinc-900 p-1 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab('planner')}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'planner'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <PenSquare size={16} />
            Planner
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'accounts'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Users size={16} />
            Accounts
            <span className="bg-zinc-700 text-xs px-1.5 py-0.5 rounded">
              {accounts.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('searches')}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'searches'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Search size={16} />
            Searches
            <span className="bg-zinc-700 text-xs px-1.5 py-0.5 rounded">
              {searchQueries.length}
            </span>
          </button>
        </div>

        {loading ? (
          <div className="text-center text-zinc-500 py-12">Loading...</div>
        ) : activeTab === 'searches' ? (
          <SearchesPage
            queries={searchQueries}
            repliedAuthors={repliedAuthors}
            status={botStatus}
            onAddQuery={handleAddSearchQuery}
            onDeleteQuery={handleDeleteSearchQuery}
            onToggleQuery={handleToggleSearchQuery}
            onTriggerSearch={handleTriggerSearch}
            onToggleSearchPolling={handleToggleSearchPolling}
            onRefreshStatus={fetchStatus}
            onMarkFollowed={handleMarkFollowed}
            onBatchFollow={handleBatchFollow}
          />
        ) : activeTab === 'planner' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Calendar & Composer */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
                <h2 className="text-sm font-medium text-zinc-400 mb-4">Next 7 Days</h2>
                <Calendar
                  posts={posts}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                />
              </div>

              <PostComposer
                selectedDate={selectedDate}
                onSaveDraft={handleSaveDraft}
                onSchedule={handleSchedule}
                onPostNow={handlePostNow}
                editingPost={editingPost}
                onCancelEdit={handleCancelEdit}
              />
            </div>

            {/* Right Column - Post Lists */}
            <div className="space-y-6">
              <PostList
                posts={scheduledPosts}
                title={`Scheduled (${scheduledPosts.length})`}
                onDelete={handleDelete}
                onEdit={handleEdit}
              />
              <PostList
                posts={draftPosts}
                title={`Drafts (${draftPosts.length})`}
                onDelete={handleDelete}
                onEdit={handleEdit}
              />
              <PostList
                posts={postedPosts}
                title="Recently Posted"
                onDelete={handleDelete}
                onEdit={handleEdit}
              />
            </div>
          </div>
        ) : (
          <AccountsPage
            accounts={accounts}
            status={botStatus}
            onAdd={handleAddAccount}
            onDelete={handleDeleteAccount}
            onTriggerPoll={handleTriggerPoll}
            onTogglePolling={handleTogglePolling}
            onRefreshStatus={fetchStatus}
          />
        )}
      </div>
    </div>
  );
}

export default App;
