'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type {
  InventoryItem, InventoryItemTask, InventoryEvent, WsMessage,
} from '@/lib/types';
import { api } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Props {
  initialItem:    InventoryItem;
  initialTasks:   InventoryItemTask[];
  initialHistory: InventoryEvent[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function forkliftLabel(name: string | null, id: number | null): string {
  if (name) return name;
  if (id)   return `FL-${String(id).padStart(3, '0')}`;
  return '—';
}

const TASK_TYPE_BADGE: Record<string, string> = {
  inbound:       'bg-sky-50 text-sky-700 border-sky-200',
  outbound:      'bg-violet-50 text-violet-700 border-violet-200',
  relocation:    'bg-amber-50 text-amber-700 border-amber-200',
  replenishment: 'bg-teal-50 text-teal-700 border-teal-200',
};

const TASK_STATUS_BADGE: Record<string, string> = {
  'pending':     'bg-yellow-50 text-yellow-800 border-yellow-200',
  'in-progress': 'bg-blue-50  text-blue-800  border-blue-200',
  'completed':   'bg-green-50 text-green-800 border-green-200',
  'delayed':     'bg-red-50   text-red-800   border-red-200',
};

const TASK_TYPE_LABEL: Record<string, string> = {
  inbound: 'Inbound', outbound: 'Outbound',
  relocation: 'Relocation', replenishment: 'Replenishment',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function InventoryItemDetail({ initialItem, initialTasks, initialHistory }: Props) {
  const [item,    setItem]    = useState<InventoryItem>(initialItem);
  const [tasks,   setTasks]   = useState<InventoryItemTask[]>(initialTasks);
  const [history, setHistory] = useState<InventoryEvent[]>(initialHistory);

  // Client-side fetch in case SSR was offline.
  useEffect(() => {
    const id = initialItem.id;
    if (!initialItem.item_name) {
      api.inventory.getById(id).then(setItem).catch(() => {});
    }
    if (!initialTasks.length) {
      api.inventory.getTasks(id).then(setTasks).catch(() => {});
    }
    if (!initialHistory.length) {
      api.inventory.getHistory(id).then(setHistory).catch(() => {});
    }
  }, [initialItem.id, initialItem.item_name, initialTasks.length, initialHistory.length]);

  const onMessage = useCallback((msg: WsMessage) => {
    // Live quantity + history update when this item changes.
    if (msg.type === 'inventory_update' && msg.payload.id === item.id) {
      setItem((prev) => ({
        ...prev,
        quantity:      msg.payload.quantity,
        location_zone: msg.payload.location_zone,
        last_updated:  new Date().toISOString(),
      }));
      // Refresh history in background so the timeline stays current.
      api.inventory.getHistory(item.id).then(setHistory).catch(() => {});
    }

    // Prepend newly created tasks linked to this item.
    if (msg.type === 'task_created' && msg.payload.inventory_item_id === item.id) {
      const newTask: InventoryItemTask = {
        id:                msg.payload.id,
        type:              msg.payload.type,
        forklift_id:       msg.payload.forklift_id,
        forklift_name:     null,
        status:            msg.payload.status,
        origin_zone:       msg.payload.origin_zone,
        destination_zone:  msg.payload.destination_zone,
        inventory_item_id: msg.payload.inventory_item_id,
        item_name:         msg.payload.item_name,
        created_at:        msg.payload.created_at,
        updated_at:        msg.payload.updated_at,
      };
      setTasks((prev) => [newTask, ...prev].slice(0, 30));
    }

    // Update existing task status when it progresses.
    if (msg.type === 'task_update') {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === msg.payload.id ? { ...t, ...msg.payload } : t
        )
      );
    }
  }, [item.id]);

  const { connected } = useWebSocket({ onMessage });

  const qtyColor =
    item.quantity === 0   ? 'text-red-600' :
    item.quantity <= 10   ? 'text-yellow-600' :
    item.quantity > 50    ? 'text-green-600' :
    'text-gray-900';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Link
            href="/inventory"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            ← Inventory
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {item.item_name || `Item #${item.id}`}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            {item.location_zone && (
              <span className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 font-mono text-sm font-semibold text-gray-700">
                Zone {item.location_zone}
              </span>
            )}
            <span className={`text-3xl font-extrabold tabular-nums ${qtyColor}`}>
              {item.quantity}
            </span>
            <span className="text-sm text-gray-500">units</span>
            {item.quantity === 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                Out of stock
              </span>
            )}
            {item.quantity > 0 && item.quantity <= 10 && (
              <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                Low stock
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            Last updated {fmtDate(item.last_updated)}
          </p>
        </div>

        {/* Live badge */}
        <div className="flex items-center gap-2 self-start text-sm">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-gray-500">{connected ? 'Live' : 'Reconnecting…'}</span>
        </div>
      </div>

      {/* ── Two-column layout ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

        {/* ── SECTION A: Quantity History ───────────────────────────────────── */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Quantity History</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Change</th>
                  <th className="px-4 py-3">New Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                      No quantity changes recorded yet.
                    </td>
                  </tr>
                ) : (
                  history.map((ev) => {
                    const p = ev.payload;
                    let eventBadge: React.ReactNode;
                    let changeCell: React.ReactNode;

                    if (ev.type === 'inventory_restocked') {
                      eventBadge = (
                        <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          ↑ Restocked
                        </span>
                      );
                      changeCell = (
                        <span className="font-mono font-semibold text-green-600">
                          +{p.delta ?? 0}
                        </span>
                      );
                    } else if (ev.type === 'inventory_depleted') {
                      eventBadge = (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                          ↓ Depleted
                        </span>
                      );
                      changeCell = (
                        <span className="font-mono font-semibold text-red-600">
                          {p.delta ?? 0}
                        </span>
                      );
                    } else {
                      eventBadge = (
                        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          → Relocated
                        </span>
                      );
                      changeCell = (
                        <span className="font-mono text-blue-700">
                          {p.from_zone} → {p.to_zone}
                        </span>
                      );
                    }

                    return (
                      <tr key={ev.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                          {fmtTime(ev.timestamp)}
                        </td>
                        <td className="px-4 py-3">{eventBadge}</td>
                        <td className="px-4 py-3 text-sm">{changeCell}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-sm text-gray-700">
                          {ev.type === 'inventory_relocated' ? '—' : (p.new_qty ?? '—')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {history.length > 0 && (
            <p className="text-xs text-gray-400">Showing last {history.length} events</p>
          )}
        </div>

        {/* ── SECTION B: Related Tasks ──────────────────────────────────────── */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Related Tasks</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3">Forklift</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">
                      No tasks recorded for this item.
                    </td>
                  </tr>
                ) : (
                  tasks.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">
                        #{t.id}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TASK_TYPE_BADGE[t.type] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                          {TASK_TYPE_LABEL[t.type] ?? t.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {t.origin_zone ?? '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {t.destination_zone ?? '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {forkliftLabel(t.forklift_name, t.forklift_id)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${TASK_STATUS_BADGE[t.status] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                        {fmtDate(t.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {tasks.length > 0 && (
            <p className="text-xs text-gray-400">Showing last {tasks.length} tasks</p>
          )}
        </div>

      </div>
    </div>
  );
}
