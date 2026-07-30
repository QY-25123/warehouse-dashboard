'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { getClientToken } from '@/lib/client-auth';
import { startNotionOAuth } from '@/lib/notion-oauth';
import type { NotionStatus, NotionPage } from '@/lib/types';

interface Props {
  /** Called after a new page is confirmed so AIWorkflow can react. */
  onStatusChange?: (status: NotionStatus) => void;
}

const PANEL = {
  background: '#1D1A26',
  border: '1px solid #2D293D',
  borderRadius: 12,
  padding: '18px 22px',
} as const;

const LABEL = {
  fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
  color: '#7B778A', textTransform: 'uppercase' as const, marginBottom: 12,
} as const;

// ── Page picker sub-component ─────────────────────────────────────────────────

function PagePicker({
  accessToken,
  onPick,
}: {
  accessToken: string | undefined;
  onPick: (id: string, title: string) => void;
}) {
  const [query, setQuery]   = useState('');
  const [pages, setPages]   = useState<NotionPage[]>([]);
  const [loading, setLoad]  = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setLoad(true);
    try {
      const token = await getClientToken();
      const results = await api.notion.searchPages(query.trim(), token);
      setPages(results);
      setSearched(true);
    } catch {
      setPages([]);
      setSearched(true);
    } finally {
      setLoad(false);
    }
  }, [query]);

  return (
    <div style={{ marginTop: 14 }}>
      <p style={{ ...LABEL, marginBottom: 8 }}>SELECT PARENT PAGE</p>
      <p style={{ fontSize: 12, color: '#9E9AAA', marginBottom: 10 }}>
        Execution reports will be saved as sub-pages of the page you choose.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Search by page name…"
          style={{
            flex: 1, padding: '7px 12px',
            background: '#13111A', border: '1px solid #2D293D',
            borderRadius: 7, color: '#FAF0FF', fontSize: 13, outline: 'none',
          }}
        />
        <button
          onClick={search}
          disabled={loading}
          style={{
            background: '#2D293D', color: '#9E9AAA',
            border: '1px solid #3D3950', borderRadius: 7,
            padding: '7px 14px', fontSize: 13, cursor: 'pointer',
          }}
        >
          {loading ? '…' : 'Search'}
        </button>
      </div>

      {!searched && (
        <p style={{ fontSize: 12, color: '#5E5A70' }}>
          Type a page name and press Search.
        </p>
      )}
      {searched && pages.length === 0 && (
        <p style={{ fontSize: 12, color: '#5E5A70' }}>
          No pages found for &quot;{query}&quot;. Try a different name.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pages.map(p => (
          <button
            key={p.id}
            onClick={() => onPick(p.id, p.title)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#252033', border: '1px solid #2D293D',
              borderRadius: 8, padding: '8px 12px',
              textAlign: 'left', cursor: 'pointer',
              transition: 'background 0.1s',
            }}
          >
            <span style={{ fontSize: 16 }}>📄</span>
            <span style={{ fontSize: 13, color: '#FAF0FF', fontWeight: 500 }}>{p.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


// ── Main component ────────────────────────────────────────────────────────────

export function NotionConnect({ onStatusChange }: Props) {
  const [notion, setNotion]         = useState<NotionStatus | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [connecting, setConn]       = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const token  = await getClientToken();
      const status = await api.notion.status(token);
      setNotion(status);
      onStatusChange?.(status);
    } catch {
      setNotion({ connected: false });
    }
  }, [onStatusChange]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  async function handleConnect() {
    setConn(true);
    try {
      await startNotionOAuth(); // redirects away — no return value
    } catch (e) {
      console.error('Notion OAuth start failed:', e);
      setConn(false);
    }
  }

  async function handleDisconnect() {
    const token = await getClientToken();
    await api.notion.disconnect(token);
    setNotion({ connected: false });
    setShowPicker(false);
    onStatusChange?.({ connected: false });
  }

  async function handlePickPage(pageId: string, pageTitle: string) {
    const token = await getClientToken();
    await api.notion.setParent(pageId, pageTitle, token);
    setShowPicker(false);
    const updated: NotionStatus = {
      ...notion!,
      parent_page_id: pageId,
      parent_page_title: pageTitle,
    };
    setNotion(updated);
    onStatusChange?.(updated);
  }

  // ── Render: not connected ─────────────────────────────────────────────────

  if (!notion?.connected) {
    return (
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {/* Notion logo */}
          <svg width="20" height="20" viewBox="0 0 100 100" fill="none">
            <path d="M6 7.8C6 5.2 8 3 10.5 3h67.6c.8 0 1.6.2 2.3.6l7.6 5.1c.7.4 1 1.2 1 2v79.5c0 2.6-2 4.8-4.5 4.8H10.5C8 95 6 92.8 6 90.2V7.8z" fill="white"/>
            <path d="M28.5 22.5l5.5 3.7V73l-5.5-3.7V22.5zm43 0l-5.5 3.7V73l5.5-3.7V22.5zM28.5 22.5l43 0M28.5 72.9l43 0" stroke="#000" strokeWidth="4"/>
            <text x="50" y="55" textAnchor="middle" fontSize="36" fontWeight="bold" fill="#000">N</text>
          </svg>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#FAF0FF', margin: 0 }}>Notion Reports</p>
            <p style={{ fontSize: 11, color: '#7B778A', margin: 0 }}>Not connected — reports won't be saved</p>
          </div>
        </div>
        <button
          onClick={handleConnect}
          disabled={connecting}
          style={{
            background: connecting ? '#2D293D' : '#FAF0FF',
            color: connecting ? '#7B778A' : '#13111A',
            border: 'none', borderRadius: 8,
            padding: '8px 18px', fontSize: 13, fontWeight: 600,
            cursor: connecting ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {connecting ? 'Redirecting…' : 'Connect to Notion'}
        </button>
      </div>
    );
  }

  // ── Render: connected ─────────────────────────────────────────────────────

  const hasParent = !!notion.parent_page_id;

  return (
    <div style={PANEL}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{
          display: 'inline-block', width: 8, height: 8,
          borderRadius: '50%', background: '#4ADE80',
        }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#FAF0FF', margin: 0 }}>
            {notion.workspace_name ?? 'Notion'}
          </p>
          {hasParent ? (
            <p style={{ fontSize: 11, color: '#9E9AAA', margin: 0 }}>
              Reports → <span style={{ color: '#A78BFA' }}>{notion.parent_page_title}</span>
            </p>
          ) : (
            <p style={{ fontSize: 11, color: '#FDE047', margin: 0 }}>
              No parent page selected — pick one below
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowPicker(v => !v)}
            style={{
              background: '#252033', color: '#9E9AAA',
              border: '1px solid #2D293D', borderRadius: 7,
              padding: '5px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >
            {showPicker ? 'Cancel' : (hasParent ? 'Change page' : 'Pick page')}
          </button>
          <button
            onClick={handleDisconnect}
            style={{
              background: 'transparent', color: '#5E5A70',
              border: '1px solid #2D293D', borderRadius: 7,
              padding: '5px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Page picker */}
      {showPicker && (
        <PagePicker accessToken={undefined} onPick={handlePickPage} />
      )}
    </div>
  );
}
