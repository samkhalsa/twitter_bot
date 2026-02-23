import { useState } from 'react';
import { Twitter, Lock, Loader2 } from 'lucide-react';

interface LoginProps {
  onLogin: (password: string) => Promise<boolean>;
}

export function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const success = await onLogin(password);
      if (!success) {
        setError('Invalid password');
      }
    } catch {
      setError('Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <Twitter className="text-blue-400" size={32} />
          <h1 className="text-2xl font-bold text-white">Content Planner</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={18} className="text-zinc-500" />
            <span className="text-sm text-zinc-400">Enter password to continue</span>
          </div>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 mb-4"
            autoFocus
          />

          {error && (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={!password || loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
