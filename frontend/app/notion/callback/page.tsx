'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { exchangeCode, loadOAuthSession, clearOAuthSession } from '@/lib/notion-oauth';
import { api } from '@/lib/api';
import { getClientToken } from '@/lib/client-auth';

function Spinner() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', gap: 16,
      background: '#13111A', color: '#FAF0FF',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '3px solid #2D293D', borderTopColor: '#8B5CF6',
        animation: 'spin 0.8s linear infinite',
      }} />
      <p style={{ fontSize: 14, color: '#9E9AAA' }}>Connecting to Notion…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function CallbackHandler() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [error, setError]   = useState('');

  useEffect(() => {
    async function handle() {
      const code  = searchParams.get('code');
      const state = searchParams.get('state');
      const err   = searchParams.get('error');

      if (err) {
        setError(`Notion authorization denied: ${err}`);
        setStatus('error');
        return;
      }
      if (!code) {
        setError('No authorization code in callback URL.');
        setStatus('error');
        return;
      }

      const session = loadOAuthSession();
      if (!session) {
        setError('OAuth session expired. Please try connecting again.');
        setStatus('error');
        return;
      }

      if (state !== session.state) {
        setError('State mismatch — possible CSRF. Please try again.');
        setStatus('error');
        return;
      }

      try {
        const redirectUri = `${window.location.origin}/notion/callback`;
        const tokens = await exchangeCode(code, session.clientId, redirectUri, session.verifier);
        clearOAuthSession();

        const token = await getClientToken();
        await api.notion.connect({
          access_token:   tokens.access_token,
          refresh_token:  tokens.refresh_token,
          workspace_id:   tokens.workspace_id,
          workspace_name: tokens.workspace_name,
          client_id:      session.clientId,
        }, token);

        router.replace('/ai?notion=connected');
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setStatus('error');
      }
    }

    handle();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'loading') return <Spinner />;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', gap: 16,
      background: '#13111A', color: '#FAF0FF',
    }}>
      <p style={{ fontSize: 13, color: '#F87171', maxWidth: 400, textAlign: 'center' }}>
        {error}
      </p>
      <button
        onClick={() => router.replace('/ai')}
        style={{
          background: '#2D293D', color: '#9E9AAA', border: '1px solid #3D3950',
          borderRadius: 8, padding: '8px 18px', fontSize: 13, cursor: 'pointer',
        }}
      >
        Back to AI Planner
      </button>
    </div>
  );
}

export default function NotionCallbackPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CallbackHandler />
    </Suspense>
  );
}
