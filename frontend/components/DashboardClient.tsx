'use client';

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { KpiCard } from './KpiCard';
import { ThroughputChart } from './ThroughputChart';
import { api } from '@/lib/api';
import { getClientToken } from '@/lib/client-auth';
import type { AnalyticsSummary, ThroughputBucket, ForkliftTaskCount, Alert } from '@/lib/types';

const PANEL: CSSProperties = {
  background: '#1D1A26',
  border: '1px solid #2D293D',
  borderRadius: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,0.45)',
  padding: '20px 24px',
};

const SECTION_LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
  color: '#7B778A', textTransform: 'uppercase', marginBottom: 16,
};

const EMPTY_SUMMARY: AnalyticsSummary = {
  tasks_per_hour: 0,
  fleet_utilization_pct: 0,
  open_alerts: 0,
  pending_tasks: 0,
  active_tasks: 0,
};

const SEVERITY_STYLE: Record<Alert['severity'], { color: string; bg: string; border: string; label: string }> = {
  info:     { color: '#60A5FA', bg: '#3B82F615', border: '#3B82F640', label: 'INFO'     },
  warning:  { color: '#FBBF24', bg: '#F59E0B15', border: '#F59E0B40', label: 'WARN'     },
  critical: { color: '#F87171', bg: '#EF444415', border: '#EF444440', label: 'CRITICAL' },
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Forklift Tasks Chart ──────────────────────────────────────────────────────

function ForkliftTasksChart({ data }: { data: ForkliftTaskCount[] }) {
  if (data.length === 0) {
    return (
      <div style={{ padding: '24px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#9E9AAA', fontSize: 13 }}>No completed tasks in the last 24 hours yet</p>
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.tasks_completed), 1);
  const ROW_H = 28;
  const LABEL_W = 70;
  const COUNT_W = 36;
  const BAR_AREA = 220;
  const svgH = data.length * ROW_H + 4;

  return (
    <svg
      viewBox={`0 0 ${LABEL_W + BAR_AREA + COUNT_W + 8} ${svgH}`}
      className="w-full"
      style={{ display: 'block' }}
      aria-label="Tasks completed per forklift in last 24 hours"
    >
      {data.map((d, i) => {
        const y      = i * ROW_H + 4;
        const barW   = Math.max((d.tasks_completed / max) * BAR_AREA, 2);
        const trackX = LABEL_W;
        const isTop  = i === 0;

        return (
          <g key={d.forklift_id}>
            {/* Forklift name */}
            <text
              x={LABEL_W - 8} y={y + ROW_H / 2 + 4}
              textAnchor="end" fontSize={11}
              fill={isTop ? '#FAF0FF' : '#9E9AAA'}
              fontWeight={isTop ? 600 : 400}
            >
              {d.name}
            </text>

            {/* Track */}
            <rect
              x={trackX} y={y + 6}
              width={BAR_AREA} height={16}
              fill="#2D293D" rx={3}
            />

            {/* Bar */}
            <rect
              x={trackX} y={y + 6}
              width={barW} height={16}
              fill={isTop ? '#FB923C' : '#22D3EE'}
              rx={3}
              opacity={0.9}
            >
              <title>{`${d.name}: ${d.tasks_completed} tasks`}</title>
            </rect>

            {/* Count */}
            <text
              x={trackX + BAR_AREA + 8}
              y={y + ROW_H / 2 + 4}
              fontSize={11} fill="#7B778A"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {d.tasks_completed}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Active Alerts List ────────────────────────────────────────────────────────

function AlertsList({ alerts }: { alerts: Alert[] }) {
  const sorted = [...alerts]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  if (sorted.length === 0) {
    return (
      <div style={{ padding: '24px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#9E9AAA', fontSize: 13 }}>No active alerts</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map((a) => {
        const sev = SEVERITY_STYLE[a.severity];
        const msg = a.message.length > 90 ? a.message.slice(0, 87) + '…' : a.message;
        return (
          <div key={a.id} style={{
            background: sev.bg,
            border: `1px solid ${sev.border}`,
            borderLeft: `3px solid ${sev.color}`,
            borderRadius: 8,
            padding: '8px 12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, color: sev.color,
                background: `${sev.color}20`, border: `1px solid ${sev.color}40`,
                borderRadius: 999, padding: '1px 6px', letterSpacing: '0.08em',
              }}>
                {sev.label}
              </span>
              <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 'auto' }}>
                {timeAgo(a.created_at)}
              </span>
            </div>
            <p style={{ fontSize: 11, color: '#C0B8D0', lineHeight: 1.5 }}>{msg}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Dashboard Client ─────────────────────────────────────────────────────

interface Props {
  initialSummary: AnalyticsSummary | null;
  initialThroughput: ThroughputBucket[];
  initialForkliftTasks: ForkliftTaskCount[];
  initialAlerts: Alert[];
}

export function DashboardClient({
  initialSummary,
  initialThroughput,
  initialForkliftTasks,
  initialAlerts,
}: Props) {
  const [summary, setSummary]             = useState<AnalyticsSummary>(initialSummary ?? EMPTY_SUMMARY);
  const [throughput, setThroughput]       = useState<ThroughputBucket[]>(initialThroughput);
  const [forkliftTasks, setForkliftTasks] = useState<ForkliftTaskCount[]>(initialForkliftTasks);
  const [alerts, setAlerts]               = useState<Alert[]>(initialAlerts);
  const [lastRefresh, setLastRefresh]     = useState<number>(Date.now());
  const [secsAgo, setSecsAgo]             = useState<number>(0);

  const refresh = useCallback(async () => {
    try {
      const token = await getClientToken();
      const [s, t, f, a] = await Promise.allSettled([
        api.analytics.summary(token),
        api.analytics.throughput(token),
        api.analytics.forkliftTasks(token),
        api.alerts.list({ include_resolved: false }, token),
      ]);
      if (s.status === 'fulfilled') setSummary(s.value);
      if (t.status === 'fulfilled') setThroughput(t.value);
      if (f.status === 'fulfilled') setForkliftTasks(f.value);
      if (a.status === 'fulfilled') setAlerts(a.value);
      setLastRefresh(Date.now());
      setSecsAgo(0);
    } catch { /* backend offline — keep stale values */ }
  }, []);

  // Auto-refresh every 30 seconds.
  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Tick the "refreshed Xs ago" counter every second.
  useEffect(() => {
    const id = setInterval(
      () => setSecsAgo(Math.floor((Date.now() - lastRefresh) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [lastRefresh]);

  const alertsAccent =
    summary.open_alerts === 0 ? '#7B778A'
    : summary.open_alerts >= 3 ? '#F87171'
    : '#FDE047';

  const refreshLabel =
    secsAgo < 5 ? 'just now' : `${secsAgo}s ago`;

  return (
    <div style={{ background: 'transparent', minHeight: '100vh', borderTop: '3px solid #FB923C' }}>
      <div className="mx-auto px-4 py-6 sm:px-6 sm:py-7" style={{ maxWidth: 1280 }}>

        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#FAF0FF', letterSpacing: '0.06em' }}>
              OPERATIONS CENTER
            </h1>
            <p style={{ fontSize: 12, color: '#9E9AAA', marginTop: 4 }}>
              Real-time warehouse performance metrics
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ height: 7, width: 7, borderRadius: '50%', background: '#10B981', display: 'inline-block' }}
              className="animate-pulse" />
            <span style={{ fontSize: 12, color: '#9E9AAA' }}>
              Refreshed {refreshLabel} · auto-refresh 30 s
            </span>
          </div>
        </div>

        {/* KPI row — 2 cols on mobile/tablet, 4 cols on desktop */}
        <div className="grid grid-cols-2 gap-4 mb-5 lg:grid-cols-4">
          <KpiCard
            label="Tasks / Hour"
            value={summary.tasks_per_hour}
            accent="#4ADE80"
            sub="completed in last 60 min"
          />
          <KpiCard
            label="Fleet Utilization"
            value={summary.fleet_utilization_pct}
            unit="%"
            accent="#22D3EE"
            sub="forklifts currently active"
          />
          <KpiCard
            label="Open Alerts"
            value={summary.open_alerts}
            accent={alertsAccent}
            sub="unresolved"
          />
          <KpiCard
            label="Pending Tasks"
            value={summary.pending_tasks}
            accent="#FB923C"
            sub={`${summary.active_tasks} in progress`}
          />
        </div>

        {/* Throughput chart */}
        <div style={{ ...PANEL, marginBottom: 16 }}>
          <p style={SECTION_LABEL}>
            THROUGHPUT — LAST 24 HOURS
            <span style={{ fontWeight: 400, color: '#4B5563', marginLeft: 8 }}>
              tasks completed per hour
            </span>
          </p>
          <ThroughputChart data={throughput} />
        </div>

        {/* Bottom row — stacked on mobile, side-by-side on md+ */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

          <div style={PANEL}>
            <p style={SECTION_LABEL}>TASKS COMPLETED BY FORKLIFT — 24H</p>
            <ForkliftTasksChart data={forkliftTasks} />
          </div>

          <div style={PANEL}>
            <p style={SECTION_LABEL}>ACTIVE ALERTS</p>
            <AlertsList alerts={alerts} />
          </div>

        </div>
      </div>
    </div>
  );
}
