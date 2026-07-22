'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { setTokenCookie } from '@/lib/auth';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/forklifts';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      setTokenCookie(data.session.access_token);
    }

    router.push(redirect);
  }

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: '#13111A' }}>
      <div className="w-full max-w-sm space-y-6 rounded-xl p-8" style={{ background: '#1D1A26', border: '1px solid #2D293D', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>
        <div className="text-center">
          <h1 className="text-xl font-bold" style={{ color: '#FB923C' }}>Warehouse Dashboard</h1>
          <p className="mt-1 text-sm" style={{ color: '#7B778A' }}>Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium" style={{ color: '#9E9AAA' }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ background: '#13111A', border: '1px solid #3A3550', color: '#FAF0FF' }}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium" style={{ color: '#9E9AAA' }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ background: '#13111A', border: '1px solid #3A3550', color: '#FAF0FF' }}
            />
          </div>

          {error && (
            <p className="rounded-lg px-3 py-2 text-sm" style={{ background: '#F8717115', color: '#F87171', border: '1px solid #F8717140' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: '#FB923C', color: '#13111A' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
