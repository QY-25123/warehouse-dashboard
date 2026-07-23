'use client';

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { getClientToken } from '@/lib/client-auth';
import { useAuth } from '@/contexts/AuthContext';
import { useWebSocket } from '@/hooks/useWebSocket';
import type {
  TelegramConversation, TelegramConversationDetail,
  TelegramMessage, TelegramSessionState, WsMessage, AIPlan,
} from '@/lib/types';

// ── Style constants ───────────────────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: '#1D1A26',
  border: '1px solid #2D293D',
  borderRadius: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,0.45)',
};

const STATE_STYLE: Record<TelegramSessionState, { color: string; bg: string; label: string }> = {
  idle:                   { color: '#5E5A70', bg: '#2D293D',    label: 'Idle'          },
  chatting:               { color: '#60A5FA', bg: '#60A5FA15',  label: 'Chatting'      },
  awaiting_confirmation:  { color: '#A78BFA', bg: '#A78BFA15',  label: 'Confirming'    },
  generating:             { color: '#FCD34D', bg: '#FCD34D15',  label: 'Planning…'     },
  awaiting_plan_approval: { color: '#4ADE80', bg: '#4ADE8015',  label: 'Plan Ready'    },
  executing:              { color: '#F87171', bg: '#F8717115',   label: 'Executing'     },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${r}s` : `${r}s`;
}

// ── State badge ───────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: TelegramSessionState }) {
  const s = STATE_STYLE[state];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: s.color, background: s.bg,
      border: `1px solid ${s.color}40`, borderRadius: 999,
      padding: '2px 8px', letterSpacing: '0.06em',
    }}>
      {s.label}
    </span>
  );
}

// ── Pending plan card ─────────────────────────────────────────────────────────

function PlanCard({ plan, isAdmin, onExecute, onReject }: {
  plan: AIPlan;
  isAdmin: boolean;
  onExecute: () => void;
  onReject: () => void;
}) {
  return (
    <div style={{
      margin: '12px 16px',
      background: '#4ADE8010', border: '1px solid #4ADE8035',
      borderRadius: 10, padding: '14px 16px',
    }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#4ADE80', letterSpacing: '0.1em', marginBottom: 10 }}>
        PENDING PLAN — AWAITING APPROVAL
      </p>
      <div style={{ fontSize: 13, color: '#FAF0FF', marginBottom: 10 }}>
        <strong>{plan.quantity_planned} units</strong> of {plan.item_name}
        {' · '}{plan.origin_zone} → {plan.destination_zone}
        {' · '}{plan.total_trips} trip(s) across {plan.total_forklifts_used} forklift(s)
        {' · '}~{fmtSeconds(plan.makespan_s)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {plan.assignments.map(a => (
          <div key={a.forklift_id} style={{ fontSize: 12, color: '#C0B8D0' }}>
            • {a.forklift_name}: {a.trips} trip(s) · {a.units_assigned} units · ~{fmtSeconds(a.estimated_seconds)}
          </div>
        ))}
      </div>
      {isAdmin ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onExecute} style={{
            background: '#4ADE80', color: '#13111A', border: 'none',
            borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}>
            Approve & Execute
          </button>
          <button onClick={onReject} style={{
            background: '#252033', color: '#9E9AAA', border: '1px solid #2D293D',
            borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}>
            Reject
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: '#9E9AAA' }}>
          Waiting for manager to approve via Telegram.
        </p>
      )}
    </div>
  );
}

// ── Chat panel ────────────────────────────────────────────────────────────────

function ChatPanel({ detail, isAdmin, onExecute, onReset }: {
  detail: TelegramConversationDetail;
  isAdmin: boolean;
  onExecute: () => void;
  onReset: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail.messages.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Chat header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid #2D293D',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: '#229ED9', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 18, flexShrink: 0,
        }}>
          ✈️
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#FAF0FF' }}>
            {detail.phone_number}
          </div>
          <StateBadge state={detail.state} />
        </div>
        {isAdmin && (
          <button
            onClick={onReset}
            style={{
              fontSize: 11, color: '#7B778A', background: 'none',
              border: '1px solid #2D293D', borderRadius: 6,
              padding: '4px 10px', cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {detail.messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#5E5A70', fontSize: 13, paddingTop: 40 }}>
            No messages yet
          </div>
        )}
        {detail.messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Pending plan */}
      {detail.state === 'awaiting_plan_approval' && detail.pending_plan && (
        <PlanCard
          plan={detail.pending_plan}
          isAdmin={isAdmin}
          onExecute={onExecute}
          onReject={onReset}
        />
      )}

      {detail.state === 'generating' && (
        <div style={{
          margin: '0 16px 12px', padding: '10px 14px',
          background: '#FCD34D10', borderRadius: 8,
          fontSize: 12, color: '#FCD34D',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            display: 'inline-block', width: 12, height: 12,
            border: '2px solid #FCD34D30', borderTopColor: '#FCD34D',
            borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0,
          }} />
          Claude is generating an optimised plan…
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: TelegramMessage }) {
  const isInbound = msg.direction === 'inbound';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isInbound ? 'flex-start' : 'flex-end',
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: '75%',
        background: isInbound ? '#252033' : '#229ED920',
        borderRadius: isInbound ? '12px 12px 12px 3px' : '12px 12px 3px 12px',
        padding: '8px 12px',
      }}>
        <p style={{
          fontSize: 13, color: '#FAF0FF', margin: 0,
          whiteSpace: 'pre-wrap', lineHeight: 1.5,
        }}>
          {msg.content}
        </p>
        <p style={{
          fontSize: 10, color: '#5E5A70', margin: '4px 0 0',
          textAlign: 'right',
        }}>
          {fmtTime(msg.timestamp)}
        </p>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: '#5E5A70', gap: 12,
    }}>
      <div style={{ fontSize: 48 }}>✈️</div>
      <p style={{ fontSize: 14, color: '#7B778A' }}>Select a conversation</p>
      <p style={{ fontSize: 12, textAlign: 'center', maxWidth: 260, lineHeight: 1.6, color: '#5E5A70' }}>
        Messages from the Telegram bot will appear here in real time.
        Managers can create tasks by messaging the bot.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  initialConversations: TelegramConversation[];
}

export function TelegramDashboard({ initialConversations }: Props) {
  const { role } = useAuth();
  const isAdmin = role === 'admin';

  const [conversations, setConversations] = useState<TelegramConversation[]>(initialConversations);
  const [selected, setSelected]           = useState<string | null>(null);
  const [detail, setDetail]               = useState<TelegramConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadDetail = useCallback(async (chatId: string) => {
    setLoadingDetail(true);
    try {
      const token = await getClientToken();
      const d = await api.telegram.conversation(chatId, token);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const selectConversation = useCallback((chatId: string) => {
    setSelected(chatId);
    loadDetail(chatId);
  }, [loadDetail]);

  // WebSocket — listen for telegram_message events (batch already unwrapped by the hook)
  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (msg.type !== 'telegram_message') return;

    const { phone_number, direction, content, timestamp, state } = msg.payload;

    setConversations(prev => {
      const existing = prev.find(c => c.phone_number === phone_number);
      if (existing) {
        return prev.map(c =>
          c.phone_number === phone_number
            ? {
                ...c,
                last_message: content,
                updated_at: timestamp,
                state: (state as TelegramSessionState) ?? c.state,
                has_pending_plan: (state === 'awaiting_plan_approval') ? true
                  : (state === 'idle') ? false
                  : c.has_pending_plan,
              }
            : c
        ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      }
      return [
        {
          id: Date.now(),
          phone_number,
          state: (state as TelegramSessionState) ?? 'chatting',
          last_message: content,
          updated_at: timestamp,
          has_pending_plan: false,
        },
        ...prev,
      ];
    });

    if (phone_number === selected) {
      const newMsg: TelegramMessage = { direction, content, timestamp };
      setDetail(prev =>
        prev
          ? {
              ...prev,
              state: (state as TelegramSessionState) ?? prev.state,
              messages: [...prev.messages, newMsg],
              pending_plan:
                msg.payload.plan !== undefined
                  ? (msg.payload.plan ?? null)
                  : prev.pending_plan,
            }
          : prev
      );
    }
  }, [selected]);

  useWebSocket({ onMessage: handleWsMessage });

  const handleExecute = useCallback(async () => {
    if (!selected) return;
    try {
      const token = await getClientToken();
      await api.telegram.executeFromDashboard(selected, token);
      await loadDetail(selected);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Execute failed');
    }
  }, [selected, loadDetail]);

  const handleReset = useCallback(async () => {
    if (!selected) return;
    try {
      const token = await getClientToken();
      await api.telegram.resetConversation(selected, token);
      await loadDetail(selected);
    } catch { /* ignore */ }
  }, [selected, loadDetail]);

  return (
    <div style={{ background: 'transparent', minHeight: '100vh', borderTop: '3px solid #229ED9' }}>
      <div className="mx-auto px-4 py-6 sm:px-6 sm:py-7" style={{ maxWidth: 1200 }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#FAF0FF', letterSpacing: '0.06em' }}>
            TELEGRAM WORKFLOW
          </h1>
          <p style={{ fontSize: 12, color: '#9E9AAA', marginTop: 4 }}>
            Live conversations between warehouse managers and the AI agent.
          </p>
        </div>

        {/* Split layout */}
        <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 180px)', minHeight: 500 }}>

          {/* Left: conversation list */}
          <div style={{ ...PANEL, width: 280, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid #2D293D',
              fontSize: 10, fontWeight: 700, color: '#7B778A', letterSpacing: '0.12em',
            }}>
              CONVERSATIONS ({conversations.length})
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {conversations.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#5E5A70', fontSize: 13 }}>
                  No conversations yet
                </div>
              ) : conversations.map(c => (
                <ConversationRow
                  key={c.phone_number}
                  conv={c}
                  isSelected={c.phone_number === selected}
                  onClick={() => selectConversation(c.phone_number)}
                />
              ))}
            </div>
          </div>

          {/* Right: chat panel */}
          <div style={{ ...PANEL, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {loadingDetail ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5E5A70' }}>
                Loading…
              </div>
            ) : detail ? (
              <ChatPanel
                detail={detail}
                isAdmin={isAdmin}
                onExecute={handleExecute}
                onReset={handleReset}
              />
            ) : (
              <EmptyState />
            )}
          </div>
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

function ConversationRow({ conv, isSelected, onClick }: {
  conv: TelegramConversation;
  isSelected: boolean;
  onClick: () => void;
}) {
  const s = STATE_STYLE[conv.state];
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', padding: '12px 16px',
        background: isSelected ? '#229ED918' : 'transparent',
        borderBottom: '1px solid #252033', border: 'none',
        cursor: 'pointer', transition: 'background 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: s.color, flexShrink: 0,
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#FAF0FF', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {conv.phone_number}
        </span>
        <span style={{ fontSize: 10, color: '#5E5A70', flexShrink: 0 }}>
          {fmtDate(conv.updated_at)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StateBadge state={conv.state} />
        {conv.last_message && (
          <span style={{
            fontSize: 11, color: '#7B778A',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>
            {conv.last_message}
          </span>
        )}
      </div>
    </button>
  );
}
