'use client';

import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getClientToken } from '@/lib/client-auth';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { RawEmail, EmailOrder, AIPlan, WsMessage } from '@/lib/types';

// ── Shared styles ─────────────────────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: '#1D1A26',
  border: '1px solid #2D293D',
  borderRadius: 12,
  padding: '20px 24px',
};

const LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
  color: '#7B778A', textTransform: 'uppercase', marginBottom: 10,
};

const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '7px 10px', borderRadius: 6,
  border: '1px solid #2D293D', background: '#13111A',
  color: '#FAF0FF', fontSize: 13, outline: 'none',
  fontFamily: 'inherit',
};

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  pending_review: { color: '#FCD34D', bg: '#FCD34D15', label: 'PENDING REVIEW' },
  generating:     { color: '#22D3EE', bg: '#22D3EE15', label: 'GENERATING PLAN' },
  executed:       { color: '#4ADE80', bg: '#4ADE8015', label: 'EXECUTED' },
  rejected:       { color: '#7B778A', bg: '#2D293D',   label: 'REJECTED' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { color: '#9E9AAA', bg: '#2D293D', label: status.toUpperCase() };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: s.color, background: s.bg,
      border: `1px solid ${s.color}30`, borderRadius: 999,
      padding: '2px 8px', letterSpacing: '0.08em',
    }}>
      {s.label}
    </span>
  );
}

// ── Plan summary (shown after execution) ──────────────────────────────────────

function PlanSummary({ plan }: { plan: AIPlan }) {
  return (
    <div style={{
      background: '#4ADE8010', border: '1px solid #4ADE8025',
      borderRadius: 8, padding: '10px 14px', marginTop: 12,
    }}>
      <p style={{ fontSize: 11, color: '#4ADE80', fontWeight: 600, marginBottom: 6 }}>
        ✓ Plan executed — {plan.total_trips} trip{plan.total_trips !== 1 ? 's' : ''} created
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          ['Item', plan.item_name],
          ['Qty', String(plan.quantity_planned)],
          ['Route', `${plan.origin_zone} → ${plan.destination_zone}`],
          ['Forklifts', String(plan.total_forklifts_used)],
          ['Est.', `${Math.ceil(plan.makespan_s / 60)}m`],
        ].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 10, color: '#7B778A', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
            <div style={{ fontSize: 13, color: '#D8D0E8', fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Order card (pending_review / executed / rejected) ─────────────────────────

interface OrderCardProps {
  order: EmailOrder;
  onSave: (id: number, updates: Record<string, string | number>) => Promise<void>;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
}

function OrderCard({ order, onSave, onApprove, onReject }: OrderCardProps) {
  const [bodyOpen, setBodyOpen] = useState(false);
  const [draft, setDraft] = useState({
    extracted_item_name:        order.extracted_item_name ?? '',
    extracted_quantity:         String(order.extracted_quantity ?? ''),
    extracted_origin_zone:      order.extracted_origin_zone ?? '',
    extracted_destination_zone: order.extracted_destination_zone ?? '',
    extracted_notes:            order.extracted_notes ?? '',
  });
  const [saving, setSaving]   = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState('');

  const editable = order.status === 'pending_review';

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(order.id, {
        extracted_item_name:        draft.extracted_item_name,
        extracted_quantity:         parseInt(draft.extracted_quantity, 10) || order.extracted_quantity!,
        extracted_origin_zone:      draft.extracted_origin_zone,
        extracted_destination_zone: draft.extracted_destination_zone,
        extracted_notes:            draft.extracted_notes,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    setError('');
    try {
      await onApprove(order.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Approval failed');
      setApproving(false);
    }
  };

  const handleReject = async () => {
    setRejecting(true);
    try {
      await onReject(order.id);
    } catch {
      setRejecting(false);
    }
  };

  return (
    <div style={{ ...PANEL, marginBottom: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#FAF0FF', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {`Email from ${order.sender?.match(/<(.+)>/)?.[1] ?? order.sender ?? 'unknown'}`}
          </p>
          <p style={{ fontSize: 11, color: '#7B778A' }}>
            {order.sender} · {order.created_at ? new Date(order.created_at).toLocaleString() : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {order.extracted_task_type && (() => {
            const TYPE_COLOR: Record<string, string> = {
              inbound: '#22D3EE', outbound: '#FB923C',
              relocation: '#A78BFA', replenishment: '#4ADE80',
            };
            const c = TYPE_COLOR[order.extracted_task_type] ?? '#9E9AAA';
            return (
              <span style={{
                fontSize: 10, fontWeight: 700, color: c,
                background: `${c}15`, border: `1px solid ${c}30`,
                borderRadius: 999, padding: '2px 8px', letterSpacing: '0.08em',
              }}>
                {order.extracted_task_type.toUpperCase()}
              </span>
            );
          })()}
          <StatusBadge status={order.status} />
        </div>
      </div>

      {/* Original email body (collapsible) */}
      {order.email_body && (
        <div style={{ marginBottom: 14 }}>
          <button
            onClick={() => setBodyOpen(o => !o)}
            style={{
              fontSize: 11, color: '#7B778A', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, marginBottom: 6,
            }}
          >
            {bodyOpen ? '▾ Hide email' : '▸ Show original email'}
          </button>
          {bodyOpen && (
            <pre style={{
              fontSize: 12, color: '#D8D0E8', background: '#13111A',
              border: '1px solid #2D293D', borderRadius: 8,
              padding: '10px 14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 240, overflowY: 'auto', lineHeight: 1.6,
            }}>
              {order.email_body}
            </pre>
          )}
        </div>
      )}

      {/* Extracted fields */}
      <p style={LABEL}>EXTRACTED ORDER</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: '#7B778A', display: 'block', marginBottom: 4 }}>
            Item name
          </label>
          <input
            style={INPUT}
            value={draft.extracted_item_name}
            onChange={e => setDraft(d => ({ ...d, extracted_item_name: e.target.value }))}
            disabled={!editable}
            placeholder="e.g. Safety Gloves L"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#7B778A', display: 'block', marginBottom: 4 }}>
            Quantity
          </label>
          <input
            style={INPUT}
            type="number"
            min={1}
            value={draft.extracted_quantity}
            onChange={e => setDraft(d => ({ ...d, extracted_quantity: e.target.value }))}
            disabled={!editable}
            placeholder="e.g. 200"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#7B778A', display: 'block', marginBottom: 4 }}>
            Origin zone
          </label>
          <input
            style={INPUT}
            value={draft.extracted_origin_zone}
            onChange={e => setDraft(d => ({ ...d, extracted_origin_zone: e.target.value }))}
            disabled={!editable}
            placeholder="e.g. DOCK, STOR, A1"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#7B778A', display: 'block', marginBottom: 4 }}>
            Destination zone
          </label>
          <input
            style={INPUT}
            value={draft.extracted_destination_zone}
            onChange={e => setDraft(d => ({ ...d, extracted_destination_zone: e.target.value }))}
            disabled={!editable}
            placeholder="e.g. SHIP, B2"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#7B778A', display: 'block', marginBottom: 4 }}>
            Notes from Claude
          </label>
          <input
            style={INPUT}
            value={draft.extracted_notes}
            onChange={e => setDraft(d => ({ ...d, extracted_notes: e.target.value }))}
            disabled={!editable}
            placeholder="Optional notes"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          fontSize: 12, color: '#F87171', background: '#F8717112',
          border: '1px solid #F8717130', borderRadius: 6,
          padding: '8px 12px', marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {/* Executed plan summary */}
      {order.status === 'executed' && order.plan && <PlanSummary plan={order.plan} />}
      {order.status === 'executed' && order.task_ids && (
        <div style={{ marginTop: 10 }}>
          <Link href="/tasks" style={{ fontSize: 12, color: '#4ADE80', fontWeight: 600 }}>
            View tasks →
          </Link>
        </div>
      )}

      {/* Actions */}
      {editable && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: '#2D293D', color: '#D8D0E8',
              border: '1px solid #3D3850', borderRadius: 8,
              padding: '7px 16px', fontSize: 12, fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            onClick={handleApprove}
            disabled={approving}
            style={{
              background: approving ? '#FB923C60' : '#FB923C',
              color: '#13111A', border: 'none', borderRadius: 8,
              padding: '7px 16px', fontSize: 12, fontWeight: 600,
              cursor: approving ? 'not-allowed' : 'pointer',
            }}
          >
            {approving ? 'Generating plan…' : '✓ Approve & Execute'}
          </button>
          <button
            onClick={handleReject}
            disabled={rejecting}
            style={{
              background: 'none', color: '#7B778A',
              border: '1px solid #2D293D', borderRadius: 8,
              padding: '7px 14px', fontSize: 12,
              cursor: rejecting ? 'not-allowed' : 'pointer',
            }}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

// ── Email inbox card ──────────────────────────────────────────────────────────

interface InboxCardProps {
  email: RawEmail;
  alreadyExtracted: boolean;
  extracting: boolean;
  onExtract: (id: string) => void;
}

function InboxCard({ email, alreadyExtracted, extracting, onExtract }: InboxCardProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14,
      padding: '14px 16px', background: '#252033',
      borderRadius: 8, marginBottom: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#FAF0FF', marginBottom: 2 }}>
          {email.subject || '(no subject)'}
        </p>
        <p style={{ fontSize: 11, color: '#7B778A', marginBottom: 4 }}>
          {email.sender} · {email.date}
        </p>
        <p style={{ fontSize: 12, color: '#9E9AAA', fontStyle: 'italic' }}>
          {email.snippet}
        </p>
      </div>
      {alreadyExtracted ? (
        <span style={{
          fontSize: 10, color: '#4ADE80', background: '#4ADE8015',
          border: '1px solid #4ADE8030', borderRadius: 999, padding: '3px 8px',
          whiteSpace: 'nowrap', fontWeight: 600,
        }}>
          ✓ Extracted
        </span>
      ) : (
        <button
          onClick={() => onExtract(email.id)}
          disabled={extracting}
          style={{
            background: extracting ? '#8B5CF650' : '#8B5CF6',
            color: '#FAF0FF', border: 'none', borderRadius: 8,
            padding: '6px 14px', fontSize: 12, fontWeight: 600,
            cursor: extracting ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {extracting ? 'Extracting…' : '✦ Extract Order'}
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  initialOrders: EmailOrder[];
}

export function GmailOrders({ initialOrders }: Props) {
  const [orders, setOrders]     = useState<EmailOrder[]>(initialOrders);
  const [emails, setEmails]     = useState<RawEmail[] | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [inboxError, setInboxError]   = useState('');
  const [extracting, setExtracting]   = useState<Set<string>>(new Set());
  const [extractErrors, setExtractErrors] = useState<Record<string, string>>({});

  const extractedIds = new Set(orders.map(o => o.message_id));

  const refreshOrders = useCallback(async () => {
    const token = await getClientToken();
    const fresh = await api.gmail.listOrders(token).catch(() => null);
    if (fresh) setOrders(fresh);
  }, []);

  // Auto-refresh when the background poller finds a new order
  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'gmail_order') {
      refreshOrders();
    }
  }, [refreshOrders]);

  useWebSocket({ onMessage: handleWsMessage });

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true);
    setInboxError('');
    try {
      const token = await getClientToken();
      const [data] = await Promise.all([
        api.gmail.listEmails(token),
        refreshOrders(),
      ]);
      setEmails(data);
    } catch (e: unknown) {
      setInboxError(e instanceof Error ? e.message : 'Failed to load inbox');
    } finally {
      setLoadingInbox(false);
    }
  }, [refreshOrders]);

  const handleExtract = useCallback(async (messageId: string) => {
    setExtracting(prev => new Set(prev).add(messageId));
    setExtractErrors(prev => { const n = { ...prev }; delete n[messageId]; return n; });
    try {
      const token = await getClientToken();
      const order = await api.gmail.extractOrder(messageId, token);
      setOrders(prev => [order, ...prev.filter(o => o.message_id !== messageId)]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Extraction failed';
      setExtractErrors(prev => ({ ...prev, [messageId]: msg }));
    } finally {
      setExtracting(prev => { const n = new Set(prev); n.delete(messageId); return n; });
    }
  }, []);

  const handleSave = useCallback(async (id: number, updates: Record<string, string | number>) => {
    const token = await getClientToken();
    const updated = await api.gmail.patchOrder(id, updates as Parameters<typeof api.gmail.patchOrder>[1], token);
    setOrders(prev => prev.map(o => o.id === id ? updated : o));
  }, []);

  const handleApprove = useCallback(async (id: number): Promise<void> => {
    const token = await getClientToken();
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'generating' } : o));
    await api.gmail.approveOrder(id, token);
    await refreshOrders();
  }, [refreshOrders]);

  const handleReject = useCallback(async (id: number) => {
    const token = await getClientToken();
    await api.gmail.rejectOrder(id, token);
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'rejected' } : o));
  }, []);

  const pendingOrders  = orders.filter(o => o.status === 'pending_review' || o.status === 'generating');
  const doneOrders     = orders.filter(o => o.status === 'executed' || o.status === 'rejected');

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#FAF0FF', letterSpacing: '0.06em' }}>
          GMAIL ORDER INTAKE
        </h1>
        <p style={{ fontSize: 12, color: '#9E9AAA', marginTop: 4 }}>
          Emails from <span style={{ color: '#D8D0E8' }}>qijie_jerry@163.com</span> are read via
          Gmail MCP — Claude extracts inbound and outbound orders for your review.
        </p>
      </div>

      {/* ── Inbox ── */}
      <div style={{ ...PANEL, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <p style={{ ...LABEL, marginBottom: 0 }}>INBOX — RECENT EMAILS</p>
          <button
            onClick={loadInbox}
            disabled={loadingInbox}
            style={{
              background: '#2D293D', color: '#9E9AAA',
              border: '1px solid #3D3850', borderRadius: 8,
              padding: '6px 14px', fontSize: 12, cursor: loadingInbox ? 'not-allowed' : 'pointer',
            }}
          >
            {loadingInbox ? 'Loading…' : emails ? '↻ Refresh' : 'Load Inbox'}
          </button>
        </div>

        {inboxError && (
          <p style={{ fontSize: 12, color: '#F87171', marginBottom: 10 }}>{inboxError}</p>
        )}

        {emails === null && !loadingInbox && (
          <p style={{ fontSize: 13, color: '#5E5A70', textAlign: 'center', padding: '24px 0' }}>
            Click "Load Inbox" to fetch recent emails via Gmail MCP.
          </p>
        )}

        {emails !== null && emails.length === 0 && (
          <p style={{ fontSize: 13, color: '#5E5A70', textAlign: 'center', padding: '24px 0' }}>
            No emails found from qijie_jerry@163.com.
          </p>
        )}

        {emails !== null && emails.map(email => (
          <div key={email.id}>
            <InboxCard
              email={email}
              alreadyExtracted={extractedIds.has(email.id)}
              extracting={extracting.has(email.id)}
              onExtract={handleExtract}
            />
            {extractErrors[email.id] && (
              <p style={{ fontSize: 11, color: '#F87171', padding: '2px 0 6px 4px' }}>
                ⚠ {extractErrors[email.id]}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── Pending orders ── */}
      {pendingOrders.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p style={LABEL}>PENDING REVIEW ({pendingOrders.length})</p>
          {pendingOrders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              onSave={handleSave}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}

      {/* ── Completed / rejected ── */}
      {doneOrders.length > 0 && (
        <div>
          <p style={LABEL}>HISTORY</p>
          {doneOrders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              onSave={handleSave}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}

      {orders.length === 0 && pendingOrders.length === 0 && (
        <div style={{ ...PANEL, textAlign: 'center', padding: '40px 24px', color: '#5E5A70' }}>
          <p style={{ fontSize: 14 }}>No extracted orders yet.</p>
          <p style={{ fontSize: 12, marginTop: 6 }}>
            Load the inbox above and click "Extract Order" on an email to get started.
          </p>
        </div>
      )}

    </div>
  );
}
