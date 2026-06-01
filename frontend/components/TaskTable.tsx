'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Task, WsMessage } from '@/lib/types';
import { api } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Props {
  initialTasks: Task[];
}

// ── Visual constants ──────────────────────────────────────────────────────────

const STATUS_BADGE: Record<Task['status'], string> = {
  'pending':     'bg-yellow-50 text-yellow-800 border-yellow-200',
  'in-progress': 'bg-blue-50 text-blue-800 border-blue-200',
  'completed':   'bg-green-50 text-green-800 border-green-200',
  'delayed':     'bg-red-50 text-red-800 border-red-200',
};

const STATUS_DOT: Record<Task['status'], string> = {
  'pending':     'bg-yellow-400',
  'in-progress': 'bg-blue-500',
  'completed':   'bg-green-500',
  'delayed':     'bg-red-500',
};

const TYPE_LABEL: Record<Task['type'], string> = {
  inbound:       'Inbound',
  outbound:      'Outbound',
  relocation:    'Relocation',
  replenishment: 'Replenishment',
};

const TYPE_BADGE: Record<Task['type'], string> = {
  inbound:       'bg-sky-50 text-sky-700 border-sky-200',
  outbound:      'bg-violet-50 text-violet-700 border-violet-200',
  relocation:    'bg-amber-50 text-amber-700 border-amber-200',
  replenishment: 'bg-teal-50 text-teal-700 border-teal-200',
};

const STATUSES = ['pending', 'in-progress', 'completed', 'delayed'] as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day:   'numeric',
    hour:  '2-digit',
    minute:'2-digit',
  });
}

function forkliftLabel(id: number | null): string {
  if (id == null) return '—';
  return `FL-${String(id).padStart(3, '0')}`;
}

function zoneLabel(zone: string | null): string {
  return zone ?? '—';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TaskTable({ initialTasks }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filter, setFilter] = useState<Task['status'] | 'all'>('all');

  // Client-side fetch so the table is populated even when the SSR fetch failed
  // (e.g. backend unreachable from inside the Next.js Docker container).
  useEffect(() => {
    api.tasks.list()
      .then((data) => setTasks(data))
      .catch(() => {});
  }, []);

  const onMessage = useCallback((msg: WsMessage) => {
    if (msg.type !== 'task_update') return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === msg.payload.id
          ? { ...t, ...msg.payload, updated_at: new Date().toISOString() }
          : t
      )
    );
  }, []);

  const { connected } = useWebSocket({ onMessage });

  // Status summary counts (always over full list, not filtered)
  const counts = STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: tasks.filter((t) => t.status === s).length }),
    {} as Record<Task['status'], number>
  );

  const visible = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  return (
    <div className="space-y-5">
      {/* Live badge */}
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`h-2 w-2 rounded-full ${
            connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'
          }`}
        />
        <span className="text-gray-500">
          {connected ? 'Live — updating every 2 s' : 'Reconnecting…'}
        </span>
      </div>

      {/* Status summary + filter strip */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            filter === 'all'
              ? 'border-gray-900 bg-gray-900 text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          All <span className="ml-1 tabular-nums">{tasks.length}</span>
        </button>

        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium capitalize transition-colors ${
              filter === s
                ? `${STATUS_BADGE[s]} border-current`
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
            {s}
            <span className="tabular-nums">{counts[s]}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">To</th>
              <th className="px-4 py-3">Forklift</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-10 text-center text-sm text-gray-400"
                >
                  No tasks match the current filter.
                </td>
              </tr>
            ) : (
              visible.map((task) => (
                <tr
                  key={task.id}
                  className="transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    #{task.id}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TYPE_BADGE[task.type]}`}
                    >
                      {TYPE_LABEL[task.type]}
                    </span>
                  </td>
                  <td className="max-w-[140px] truncate px-4 py-3 text-xs text-gray-700"
                      title={task.item_name ?? undefined}>
                    {task.item_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {zoneLabel(task.origin_zone)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {zoneLabel(task.destination_zone)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {forkliftLabel(task.forklift_id)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[task.status]}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status]}`}
                      />
                      {task.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                    {fmtDate(task.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                    {fmtDate(task.updated_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Showing {visible.length} of {tasks.length} tasks
      </p>
    </div>
  );
}
