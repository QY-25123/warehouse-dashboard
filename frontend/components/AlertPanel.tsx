'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Alert, WsMessage } from '@/lib/types';
import { useWebSocket } from '@/hooks/useWebSocket';
import { api } from '@/lib/api';
import { getClientToken } from '@/lib/client-auth';

interface Props {
  initialAlerts: Alert[];
}

// ── Visual constants ──────────────────────────────────────────────────────────

const SEVERITY_BADGE: Record<Alert['severity'], string> = {
  info:     'bg-blue-50 text-blue-700 border-blue-200',
  warning:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

const SEVERITY_BAR: Record<Alert['severity'], string> = {
  info:     'border-l-blue-400',
  warning:  'border-l-yellow-400',
  critical: 'border-l-red-500',
};

const SEVERITY_DOT: Record<Alert['severity'], string> = {
  info:     'bg-blue-400',
  warning:  'bg-yellow-400',
  critical: 'bg-red-500',
};

const SEVERITIES = ['info', 'warning', 'critical'] as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AlertPanel({ initialAlerts }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const [severityFilter, setSeverityFilter] = useState<Alert['severity'] | 'all'>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [resolving, setResolving] = useState<Set<number>>(new Set());

  useEffect(() => {
    getClientToken().then((token) =>
      api.alerts.list({ include_resolved: true }, token)
        .then((data) => setAlerts(data))
        .catch(() => {})
    );
  }, []);

  // Keep a ref so onMessage can read the latest filter without being a dep
  const showResolvedRef = useRef(showResolved);
  showResolvedRef.current = showResolved;

  const onMessage = useCallback((msg: WsMessage) => {
    if (msg.type !== 'alert') return;
    // Prepend a synthetic alert; id=0 means no resolve button until re-fetched.
    // Re-fetch in background to get the real DB id.
    const synthetic: Alert = {
      id: 0,
      severity: msg.payload.severity,
      message: msg.payload.message,
      resolved: false,
      created_at: new Date().toISOString(),
    };
    setAlerts((prev) => [synthetic, ...prev]);
    getClientToken().then((token) =>
      api.alerts
        .list({ include_resolved: showResolvedRef.current }, token)
        .then((fresh) => setAlerts(fresh))
        .catch(() => {/* keep synthetic */})
    );
  }, []);

  const { connected } = useWebSocket({ onMessage });

  async function handleResolve(id: number) {
    if (id <= 0) return;
    setResolving((prev) => new Set(prev).add(id));
    try {
      const token = await getClientToken();
      await api.alerts.resolve(id, token);
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, resolved: true } : a))
      );
    } catch {
      // no-op — leave the button enabled for retry
    } finally {
      setResolving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Filtering
  const visible = alerts.filter((a) => {
    if (!showResolved && a.resolved) return false;
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
    return true;
  });

  const activeCounts = SEVERITIES.reduce(
    (acc, s) => ({ ...acc, [s]: alerts.filter((a) => !a.resolved && a.severity === s).length }),
    {} as Record<Alert['severity'], number>
  );
  const totalActive = alerts.filter((a) => !a.resolved).length;

  return (
    <div className="space-y-5">
      {/* Live badge */}
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
        <span className="text-gray-500">
          {connected ? 'Live — new alerts push instantly' : 'Reconnecting…'}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{totalActive}</p>
          <p className="mt-0.5 text-xs text-gray-500">Active alerts</p>
        </div>
        {SEVERITIES.map((s) => (
          <div key={s} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className={`text-2xl font-bold ${
              s === 'critical' ? 'text-red-600' : s === 'warning' ? 'text-yellow-600' : 'text-blue-600'
            }`}>
              {activeCounts[s]}
            </p>
            <p className="mt-0.5 text-xs capitalize text-gray-500">{s}</p>
          </div>
        ))}
      </div>

      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setSeverityFilter('all')}
          className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${
            severityFilter === 'all'
              ? 'border-gray-900 bg-gray-900 text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          All
        </button>
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className={`flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              severityFilter === s
                ? `${SEVERITY_BADGE[s]} border-current`
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${SEVERITY_DOT[s]}`} />
            {s}
          </button>
        ))}

        {/* Resolved toggle */}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-gray-600 select-none">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 accent-blue-600"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </div>

      {/* Alert feed */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white px-6 py-12 text-center text-sm text-gray-400 shadow-sm">
          No alerts match the current filter.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((alert, i) => (
            <div
              key={alert.id > 0 ? alert.id : `synth-${i}`}
              className={`rounded-xl border border-l-4 bg-white shadow-sm transition-opacity ${
                SEVERITY_BAR[alert.severity]
              } ${alert.resolved ? 'opacity-55' : ''}`}
            >
              <div className="flex items-start gap-3 p-4">
                {/* Severity badge */}
                <span
                  className={`mt-0.5 flex-shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${SEVERITY_BADGE[alert.severity]}`}
                >
                  {alert.severity}
                </span>

                {/* Message */}
                <p className="flex-1 text-sm leading-snug text-gray-800">
                  {alert.message}
                </p>

                {/* Timestamp + action */}
                <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                  <time className="text-xs text-gray-400">
                    {fmtDate(alert.created_at)}
                  </time>
                  {alert.resolved ? (
                    <span className="text-xs font-medium text-green-600">✓ Resolved</span>
                  ) : (
                    <button
                      onClick={() => handleResolve(alert.id)}
                      disabled={alert.id <= 0 || resolving.has(alert.id)}
                      className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {resolving.has(alert.id) ? 'Resolving…' : 'Resolve'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400">
        Showing {visible.length} of {alerts.length} alerts
      </p>
    </div>
  );
}
