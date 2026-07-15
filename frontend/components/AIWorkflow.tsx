'use client';

import { useState, useCallback, type CSSProperties } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getClientToken } from '@/lib/client-auth';
import { useAuth } from '@/contexts/AuthContext';
import type { AIPlan, AIForkliftCapacity, AITripAssignment } from '@/lib/types';

// ── Styling constants ─────────────────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 12,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  padding: '20px 24px',
};

const LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
  color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 12,
};

const TASK_TYPE_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  outbound:      { color: '#2563EB', bg: '#EFF6FF', label: 'OUTBOUND'      },
  inbound:       { color: '#059669', bg: '#ECFDF5', label: 'INBOUND'       },
  relocation:    { color: '#7C3AED', bg: '#F5F3FF', label: 'RELOCATION'    },
  replenishment: { color: '#D97706', bg: '#FFFBEB', label: 'REPLENISHMENT' },
};

const EXAMPLES = [
  'Outbound 300 units of Safety Gloves L',
  'Move 150 units of Cable Ties 100pk from A2 to E3',
  'Inbound 200 units of Cardboard Boxes L to B1',
  'Replenish Forklift Battery 48V in zone A3',
];

// ── Helper ────────────────────────────────────────────────────────────────────

function fmtSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const style = TASK_TYPE_STYLE[type] ?? { color: '#374151', bg: '#F3F4F6', label: type.toUpperCase() };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: style.color,
      background: style.bg, border: `1px solid ${style.color}30`,
      borderRadius: 999, padding: '2px 8px', letterSpacing: '0.08em',
    }}>
      {style.label}
    </span>
  );
}

function PlanCard({ plan, explanation, onExecute, executing }: {
  plan: AIPlan;
  explanation: string;
  onExecute: () => void;
  executing: boolean;
}) {
  const makespanMin = Math.ceil(plan.makespan_s / 60);

  return (
    <div style={PANEL}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <TypeBadge type={plan.task_type} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{plan.item_name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6B7280' }}>
          {plan.origin_zone} → {plan.destination_zone}
        </span>
      </div>

      {/* Claude's explanation */}
      {explanation && (
        <div style={{
          background: '#F0F9FF', border: '1px solid #BAE6FD',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>🤖</span>
          <p style={{ fontSize: 12, color: '#0C4A6E', lineHeight: 1.6, margin: 0 }}>
            {explanation}
          </p>
        </div>
      )}

      {/* Quantity summary */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16,
        padding: '12px 16px', background: '#F9FAFB', borderRadius: 8,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{plan.quantity_planned}</div>
          <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>units planned</div>
        </div>
        <div style={{ width: 1, background: '#E5E7EB' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{plan.total_trips}</div>
          <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>total trips</div>
        </div>
        <div style={{ width: 1, background: '#E5E7EB' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{plan.total_forklifts_used}</div>
          <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>forklifts</div>
        </div>
        <div style={{ width: 1, background: '#E5E7EB' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#3B82F6' }}>{makespanMin}m</div>
          <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>est. completion</div>
        </div>
      </div>

      {/* Insufficient stock warning */}
      {plan.insufficient_stock && (
        <div style={{
          background: '#FFFBEB', border: '1px solid #FDE68A',
          borderRadius: 8, padding: '8px 12px', marginBottom: 16,
          fontSize: 12, color: '#92400E',
        }}>
          ⚠ Only {plan.quantity_available} units available (requested {plan.quantity_requested}).
          Plan covers available stock only.
        </div>
      )}

      {/* Trip assignment table */}
      <p style={LABEL}>FORKLIFT ASSIGNMENTS</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
              {['Forklift', 'Capacity', 'Trips', 'Units', 'Dist. to pickup', 'Est. time'].map(h => (
                <th key={h} style={{
                  textAlign: 'left', padding: '6px 10px',
                  fontSize: 10, fontWeight: 600, color: '#6B7280',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.assignments.map((a: AITripAssignment, i: number) => (
              <tr key={a.forklift_id} style={{
                background: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB',
                borderBottom: '1px solid #F3F4F6',
              }}>
                <td style={{ padding: '8px 10px', fontWeight: 600, color: '#111827' }}>
                  {a.forklift_name}
                </td>
                <td style={{ padding: '8px 10px', color: '#374151' }}>
                  {a.capacity} units
                </td>
                <td style={{ padding: '8px 10px', color: '#374151' }}>
                  <span style={{
                    background: '#EFF6FF', color: '#1D4ED8',
                    borderRadius: 4, padding: '1px 6px', fontWeight: 600,
                  }}>
                    ×{a.trips}
                  </span>
                </td>
                <td style={{ padding: '8px 10px', color: '#374151' }}>
                  {a.units_assigned}
                </td>
                <td style={{ padding: '8px 10px', color: '#374151' }}>
                  {a.dist_to_origin_svgu} SVG-u
                </td>
                <td style={{ padding: '8px 10px', color: '#374151' }}>
                  {fmtSeconds(a.estimated_seconds)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
        <button
          onClick={onExecute}
          disabled={executing}
          style={{
            background: executing ? '#93C5FD' : '#2563EB',
            color: '#FFFFFF', border: 'none', borderRadius: 8,
            padding: '9px 20px', fontSize: 13, fontWeight: 600,
            cursor: executing ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {executing ? 'Submitting…' : `Approve & Execute (${plan.total_trips} tasks)`}
        </button>
      </div>
    </div>
  );
}


function CapacitySettings({ capacities, onUpdate }: {
  capacities: AIForkliftCapacity[];
  onUpdate: (id: number, cap: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<number, string>>(() =>
    Object.fromEntries(capacities.map(f => [f.id, String(f.capacity)]))
  );
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});

  const save = async (id: number) => {
    const val = parseInt(draft[id] ?? '', 10);
    if (isNaN(val) || val < 1) return;
    setSaving(s => ({ ...s, [id]: true }));
    try {
      await onUpdate(id, val);
      setSaved(s => ({ ...s, [id]: true }));
      setTimeout(() => setSaved(s => ({ ...s, [id]: false })), 2000);
    } finally {
      setSaving(s => ({ ...s, [id]: false }));
    }
  };

  return (
    <div style={PANEL}>
      <p style={LABEL}>FORKLIFT CAPACITY SETTINGS</p>
      <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
        Set the maximum units each forklift can carry per trip. Changes apply to future AI plans immediately.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {capacities.map(f => (
          <div key={f.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '8px 12px', background: '#F9FAFB', borderRadius: 8,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', minWidth: 70 }}>
              {f.name}
            </span>
            <span style={{
              fontSize: 10, color: f.status === 'idle' ? '#059669' : '#6B7280',
              background: f.status === 'idle' ? '#ECFDF5' : '#F3F4F6',
              borderRadius: 999, padding: '1px 6px', textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              {f.status}
            </span>
            <input
              type="number"
              min={1}
              max={10000}
              value={draft[f.id] ?? f.capacity}
              onChange={e => setDraft(d => ({ ...d, [f.id]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && save(f.id)}
              style={{
                width: 80, padding: '4px 8px', border: '1px solid #D1D5DB',
                borderRadius: 6, fontSize: 13, textAlign: 'right',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>units / trip</span>
            <button
              onClick={() => save(f.id)}
              disabled={saving[f.id]}
              style={{
                marginLeft: 'auto',
                background: saved[f.id] ? '#059669' : '#F3F4F6',
                color: saved[f.id] ? '#FFFFFF' : '#374151',
                border: '1px solid #E5E7EB', borderRadius: 6,
                padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                fontWeight: 500, transition: 'background 0.15s',
              }}
            >
              {saved[f.id] ? '✓ Saved' : saving[f.id] ? '…' : 'Save'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  initialCapacities: AIForkliftCapacity[];
}

export function AIWorkflow({ initialCapacities }: Props) {
  const { role } = useAuth();

  const [message, setMessage]     = useState('');
  const [planning, setPlanning]   = useState(false);
  const [executing, setExecuting] = useState(false);
  const [plan, setPlan]           = useState<AIPlan | null>(null);
  const [explanation, setExplan]  = useState('');
  const [error, setError]         = useState('');
  const [successMsg, setSuccess]  = useState('');
  const [capacities, setCapacities] = useState<AIForkliftCapacity[]>(initialCapacities);

  const generatePlan = useCallback(async () => {
    if (!message.trim()) return;
    setPlanning(true);
    setPlan(null);
    setExplan('');
    setError('');
    setSuccess('');
    try {
      const token = await getClientToken();
      const result = await api.ai.plan(message.trim(), token);
      setPlan(result.plan);
      setExplan(result.explanation);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setPlanning(false);
    }
  }, [message]);

  const executePlan = useCallback(async () => {
    if (!plan) return;
    setExecuting(true);
    setError('');
    try {
      const token = await getClientToken();
      const result = await api.ai.execute(plan, token);
      setSuccess(
        `✓ ${result.tasks_created} task${result.tasks_created !== 1 ? 's' : ''} submitted to the simulator. ` +
        `The forklifts will pick them up automatically.`
      );
      setPlan(null);
      setMessage('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Execution failed.');
    } finally {
      setExecuting(false);
    }
  }, [plan]);

  const updateCapacity = useCallback(async (id: number, capacity: number) => {
    const token = await getClientToken();
    const updated = await api.ai.updateCapacity(id, capacity, token);
    setCapacities(prev => prev.map(f => f.id === updated.id ? { ...f, capacity: updated.capacity } : f));
  }, []);

  return (
    <div style={{ background: '#F9FAFB', minHeight: '100vh', borderTop: '3px solid #7C3AED' }}>
      <div className="mx-auto px-4 py-6 sm:px-6 sm:py-7" style={{ maxWidth: 900 }}>

        {/* Page header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '0.06em' }}>
            AI TASK PLANNER
          </h1>
          <p style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
            Describe what you need in plain language — Claude will interpret your request,
            calculate trips based on forklift capacities, and generate an optimised execution plan.
          </p>
        </div>

        {/* Input panel */}
        <div style={{ ...PANEL, marginBottom: 16 }}>
          <p style={LABEL}>DESCRIBE YOUR TASK</p>

          {/* Example chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                onClick={() => setMessage(ex)}
                style={{
                  fontSize: 11, color: '#6B7280', background: '#F3F4F6',
                  border: '1px solid #E5E7EB', borderRadius: 999,
                  padding: '3px 10px', cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
              >
                {ex}
              </button>
            ))}
          </div>

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generatePlan();
            }}
            placeholder='e.g. "Outbound 300 units of Safety Gloves L" or "Move all Cable Ties from A2 to E3"'
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 14px', border: '1px solid #D1D5DB', borderRadius: 8,
              fontSize: 14, color: '#111827', resize: 'vertical',
              outline: 'none', fontFamily: 'inherit',
              background: '#FAFAFA',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <button
              onClick={generatePlan}
              disabled={planning || !message.trim()}
              style={{
                background: planning || !message.trim() ? '#A5B4FC' : '#7C3AED',
                color: '#FFFFFF', border: 'none', borderRadius: 8,
                padding: '9px 20px', fontSize: 13, fontWeight: 600,
                cursor: planning || !message.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {planning ? (
                <>
                  <span style={{
                    display: 'inline-block', width: 12, height: 12,
                    border: '2px solid #FFFFFF40', borderTopColor: '#FFFFFF',
                    borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                  }} />
                  Claude is analysing…
                </>
              ) : '✦ Generate Plan'}
            </button>
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>⌘ Enter</span>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            fontSize: 13, color: '#991B1B',
          }}>
            {error}
          </div>
        )}

        {/* Success message */}
        {successMsg && (
          <div style={{
            background: '#F0FDF4', border: '1px solid #BBF7D0',
            borderRadius: 8, padding: '12px 16px', marginBottom: 16,
            fontSize: 13, color: '#14532D',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{successMsg}</span>
            <Link
              href="/tasks"
              style={{
                color: '#059669', fontWeight: 600, fontSize: 12,
                textDecoration: 'none', whiteSpace: 'nowrap', marginLeft: 12,
              }}
            >
              View Tasks →
            </Link>
          </div>
        )}

        {/* Generated plan */}
        {plan && (
          <div style={{ marginBottom: 16 }}>
            <PlanCard
              plan={plan}
              explanation={explanation}
              onExecute={executePlan}
              executing={executing}
            />
          </div>
        )}

        {/* Capacity settings (admin only) */}
        {role === 'admin' && capacities.length > 0 && (
          <CapacitySettings capacities={capacities} onUpdate={updateCapacity} />
        )}

        {/* Spinner keyframe */}
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>

      </div>
    </div>
  );
}
