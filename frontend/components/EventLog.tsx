'use client';

import { useState, useCallback, useRef } from 'react';
import type { Event, WsMessage } from '@/lib/types';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Props {
  initialEvents: Event[];
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function colorForType(type: string): string {
  if (type.includes('forklift')) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (type.includes('task'))     return 'bg-green-50 text-green-700 border-green-200';
  if (type.includes('inventory')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (type.includes('alert'))    return 'bg-red-50 text-red-700 border-red-200';
  if (type.includes('zone'))     return 'bg-purple-50 text-purple-700 border-purple-200';
  return 'bg-gray-100 text-gray-500 border-gray-200';
}

function colorDot(type: string): string {
  if (type.includes('forklift'))  return 'bg-blue-400';
  if (type.includes('task'))      return 'bg-green-400';
  if (type.includes('inventory')) return 'bg-amber-400';
  if (type.includes('alert'))     return 'bg-red-500';
  if (type.includes('zone'))      return 'bg-purple-400';
  return 'bg-gray-400';
}

// ── Payload summariser ────────────────────────────────────────────────────────

function num(v: unknown): string { return Number(v).toFixed(1); }
function signed(v: unknown): string {
  const n = Number(v);
  return n > 0 ? `+${n}` : String(n);
}

function summarize(type: string, payload: Record<string, unknown>): string {
  const p = payload;
  switch (type) {
    // DB event types
    case 'forklift_status_change':
      return `FL-${p.forklift_id}: ${p.from} → ${p.to}`;
    case 'forklift_position_update':
      return `FL-${p.forklift_id} moved to (${num(p.x)}, ${num(p.y)})`;
    case 'task_status_change':
      return `Task #${p.task_id} (${p.type}): ${p.from} → ${p.to}`;
    case 'task_created':
      return `Task #${p.task_id} (${p.type}) created`;
    case 'task_delayed':
      return `Task #${p.task_id} delayed — ${p.delay_reason ?? ''}`;
    case 'inventory_updated':
      return `${p.item_name}: ${signed(p.delta)} → qty ${p.new_qty} [${p.zone}]`;
    case 'alert_triggered':
      return String(p.reason ?? p.message ?? JSON.stringify(p).slice(0, 60));
    case 'alert_resolved':
      return `Alert resolved by ${p.resolved_by ?? 'system'}`;
    case 'zone_entry':
      return `FL-${p.forklift_id} entered zone ${p.zone}`;
    case 'zone_exit':
      return `FL-${p.forklift_id} exited zone ${p.zone}`;
    case 'system_heartbeat':
      return `${p.active_forklifts} active forklifts · ${p.pending_tasks} pending tasks`;
    // WS push types (simulator broadcasts)
    case 'forklift_update':
      return `FL-${p.id} (${p.name}) → ${p.status} at (${num(p.x)}, ${num(p.y)})`;
    case 'task_update':
      return `Task #${p.id} (${p.type}) → ${p.status}`;
    case 'inventory_update':
      return `${p.item_name} → qty ${p.quantity} [${p.location_zone}]`;
    case 'alert':
      return String(p.message ?? '');
    default:
      return JSON.stringify(payload).slice(0, 80);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EventLog({ initialEvents }: Props) {
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const synthId = useRef(0);

  const onMessage = useCallback((msg: WsMessage) => {
    synthId.current -= 1;
    const synthetic: Event = {
      id: synthId.current,
      type: msg.type,
      payload: msg.payload as unknown as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    };
    setEvents((prev) => [synthetic, ...prev].slice(0, 100));
  }, []);

  const { connected } = useWebSocket({ onMessage });

  // Derive unique event types for the filter dropdown
  const eventTypes = Array.from(new Set(events.map((e) => e.type))).sort();
  const visible = typeFilter === 'all' ? events : events.filter((e) => e.type === typeFilter);

  return (
    <div className="space-y-5">
      {/* Live badge */}
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
        <span className="text-gray-500">
          {connected ? 'Live — new events prepend in real time' : 'Reconnecting…'}
        </span>
      </div>

      {/* Type filter dropdown */}
      <div className="flex items-center gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All event types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="text-sm text-gray-400">
          {visible.length} event{visible.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Colour legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {[
          { label: 'Forklift',   cls: colorDot('forklift')  },
          { label: 'Task',       cls: colorDot('task')      },
          { label: 'Inventory',  cls: colorDot('inventory') },
          { label: 'Alert',      cls: colorDot('alert')     },
          { label: 'Zone',       cls: colorDot('zone')      },
          { label: 'System',     cls: colorDot('system')    },
        ].map(({ label, cls }) => (
          <span key={label} className="flex items-center gap-1.5 text-gray-600">
            <span className={`h-2 w-2 rounded-full ${cls}`} />
            {label}
          </span>
        ))}
      </div>

      {/* Event feed */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {visible.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            No events match the current filter.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visible.map((ev) => (
              <div
                key={ev.id}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                {/* Dot */}
                <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${colorDot(ev.type)}`} />

                {/* Type badge */}
                <span
                  className={`flex-shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${colorForType(ev.type)}`}
                  style={{ maxWidth: '11rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {ev.type}
                </span>

                {/* Summary */}
                <p className="flex-1 truncate text-sm text-gray-700">
                  {summarize(ev.type, ev.payload)}
                </p>

                {/* Timestamp */}
                <time className="flex-shrink-0 text-xs text-gray-400">
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </time>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
