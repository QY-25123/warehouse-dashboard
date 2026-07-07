'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'wh_tour_done_v1';
export const TOUR_EVENT = 'open-wh-tour';

// ── Small reusable badge ──────────────────────────────────────────────────────

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      background: `${color}18`, border: `1px solid ${color}45`,
      borderRadius: 999, padding: '4px 12px', fontSize: 12, color,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

// ── Mini warehouse floor diagram ──────────────────────────────────────────────

function ZoneMiniMap() {
  const ROWS = ['A', 'B', 'C', 'D'];
  const COLS = [1, 2, 3, 4];
  const CW = 25, RH = 12;
  return (
    <svg viewBox="-22 -8 148 76" style={{ width: '100%', maxWidth: 280, display: 'block', margin: '0 auto' }}>
      {/* DOCK */}
      <rect x={-22} y={4} width={16} height={RH * ROWS.length} rx={2}
        fill="#3B82F610" stroke="#3B82F6" strokeWidth={0.7} />
      <text x={-14} y={4 + (RH * ROWS.length) / 2 + 2}
        textAnchor="middle" fontSize={4} fill="#3B82F6" fontWeight="700">DOCK</text>

      {/* SHIP */}
      <rect x={COLS.length * CW + 2} y={4} width={16} height={RH * ROWS.length} rx={2}
        fill="#F9731610" stroke="#F97316" strokeWidth={0.7} />
      <text x={COLS.length * CW + 10} y={4 + (RH * ROWS.length) / 2 + 2}
        textAnchor="middle" fontSize={4} fill="#F97316" fontWeight="700">SHIP</text>

      {/* Zone grid */}
      {ROWS.map((row, ri) =>
        COLS.map((col) => (
          <g key={`${row}${col}`}>
            <rect x={(col - 1) * CW} y={4 + ri * RH} width={CW - 1} height={RH - 1} rx={1}
              fill="#1A1D27" stroke="#2A2D3E" strokeWidth={0.4} />
            <text x={(col - 1) * CW + CW / 2} y={4 + ri * RH + 8}
              textAnchor="middle" fontSize={4} fill="#4B5563">
              {row}{col}
            </text>
          </g>
        ))
      )}

      {/* STOR */}
      <rect x={14} y={4 + ROWS.length * RH + 4} width={72} height={11} rx={2}
        fill="#8B5CF610" stroke="#8B5CF6" strokeWidth={0.7} />
      <text x={50} y={4 + ROWS.length * RH + 11}
        textAnchor="middle" fontSize={4} fill="#8B5CF6" fontWeight="700">STOR</text>

      {/* Caption */}
      <text x={50} y={-3} textAnchor="middle" fontSize={3.5} fill="#374151">
        rows A–D shown (full grid: A–K × 1–4 = 44 zones)
      </text>
    </svg>
  );
}

// ── Step definitions ──────────────────────────────────────────────────────────

interface Step { icon: string; title: string; body: ReactNode }

const STEPS: Step[] = [
  {
    icon: '🏭',
    title: 'Welcome to Warehouse Ops',
    body: (
      <div>
        <p style={{ color: '#94A3B8', lineHeight: 1.75, marginBottom: 14 }}>
          This dashboard gives you{' '}
          <strong style={{ color: '#F1F5F9' }}>real-time visibility</strong> into your
          warehouse — forklifts, tasks, inventory, and alerts — all updating live
          every 2 seconds via WebSocket.
        </p>
        <p style={{ color: '#94A3B8', lineHeight: 1.75 }}>
          This short tour covers the key concepts you need to read the dashboard
          confidently. It takes about 60 seconds.
        </p>
      </div>
    ),
  },
  {
    icon: '🗺️',
    title: 'The Warehouse Floor',
    body: (
      <div>
        <p style={{ color: '#94A3B8', lineHeight: 1.75, marginBottom: 14 }}>
          The floor is divided into{' '}
          <strong style={{ color: '#F1F5F9' }}>44 zones</strong> (rows A–K ×
          columns 1–4), plus three special areas outside the main grid:
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          <Badge color="#3B82F6" label="DOCK — inbound receiving" />
          <Badge color="#F97316" label="SHIP — outbound shipping" />
          <Badge color="#8B5CF6" label="STOR — bulk storage" />
        </div>
        <ZoneMiniMap />
      </div>
    ),
  },
  {
    icon: '🚜',
    title: 'Forklift Statuses',
    body: (
      <div>
        <p style={{ color: '#94A3B8', lineHeight: 1.75, marginBottom: 14 }}>
          Each forklift on the live map is colour-coded by what it is currently
          doing:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Badge color="#9CA3AF" label="Idle — waiting for a task" />
          <Badge color="#93C5FD" label="Moving (empty) — travelling to pickup zone" />
          <Badge color="#60A5FA" label="Moving (loaded) — carrying cargo to destination" />
          <Badge color="#10B981" label="Loading — picking up or dropping off cargo" />
          <Badge color="#EF4444" label="Error — sensor fault, auto-recovers in ~10 s" />
        </div>
      </div>
    ),
  },
  {
    icon: '📋',
    title: 'Task Types',
    body: (
      <div>
        <p style={{ color: '#94A3B8', lineHeight: 1.75, marginBottom: 14 }}>
          The system runs four types of tasks. Each follows a two-leg forklift
          journey: travel empty → load → travel loaded → unload.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16 }}>
          <Badge color="#A78BFA" label="Inbound — DOCK → zone (new stock arriving)" />
          <Badge color="#FB923C" label="Outbound — zone → SHIP (fulfilling orders)" />
          <Badge color="#60A5FA" label="Relocation — zone → zone (reorganising floor)" />
          <Badge color="#10B981" label="Replenishment — STOR → zone (restocking low items)" />
        </div>
        <p style={{ color: '#4B5563', fontSize: 12, lineHeight: 1.65 }}>
          Task states:{' '}
          <strong style={{ color: '#64748B' }}>pending</strong> →{' '}
          <strong style={{ color: '#64748B' }}>in-progress</strong> →{' '}
          <strong style={{ color: '#64748B' }}>completed</strong>. A sensor fault
          mid-task sets the task to{' '}
          <strong style={{ color: '#EF4444' }}>delayed</strong> until the
          forklift recovers automatically.
        </p>
      </div>
    ),
  },
  {
    icon: '✅',
    title: "You're All Set",
    body: (
      <div>
        <p style={{ color: '#94A3B8', lineHeight: 1.75, marginBottom: 14 }}>
          A few things to keep in mind as you use the dashboard:
        </p>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          {[
            'Critical alerts (sensor disconnects, zone congestion) should be reviewed and resolved promptly.',
            'The Operations Center shows your last-60-min throughput and fleet utilization at a glance.',
            'Admins can resolve alerts, manage users, and reset simulation data from the Users admin panel.',
            'The throughput chart covers the last 24 hours — use it to spot slow periods in your shift.',
          ].map((item) => (
            <li key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: '#3B82F6', marginTop: 1, flexShrink: 0, fontSize: 14 }}>›</span>
              <span style={{ color: '#94A3B8', fontSize: 13, lineHeight: 1.65 }}>{item}</span>
            </li>
          ))}
        </ul>
        <p style={{ color: '#4B5563', fontSize: 12 }}>
          Replay this tour anytime via the{' '}
          <strong style={{ color: '#64748B' }}>?</strong> button in the top
          navigation bar.
        </p>
      </div>
    ),
  },
];

// ── Main component ────────────────────────────────────────────────────────────

export function OnboardingTour() {
  const { user, loading } = useAuth();
  const [open, setOpen]   = useState(false);
  const [step, setStep]   = useState(0);

  // Auto-show on first login.
  useEffect(() => {
    if (!loading && user) {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setStep(0);
        setOpen(true);
      }
    }
  }, [user, loading]);

  // Re-open when the nav ? button fires the custom event.
  useEffect(() => {
    const handler = () => { setStep(0); setOpen(true); };
    window.addEventListener(TOUR_EVENT, handler);
    return () => window.removeEventListener(TOUR_EVENT, handler);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    localStorage.setItem(STORAGE_KEY, '1');
  }, []);

  if (!open) return null;

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast  = step === STEPS.length - 1;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.72)', padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: '#1A1D27',
        border: '1px solid #2A2D3E',
        borderRadius: 20,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          background: '#0F1117', borderBottom: '1px solid #2A2D3E',
          padding: '18px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 26, lineHeight: 1 }}>{current.icon}</span>
            <div>
              <p style={{
                fontSize: 10, color: '#4B5563', letterSpacing: '0.1em',
                fontWeight: 600, textTransform: 'uppercase', marginBottom: 3,
              }}>
                Step {step + 1} of {STEPS.length}
              </p>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#F1F5F9', lineHeight: 1 }}>
                {current.title}
              </h2>
            </div>
          </div>
          <button
            onClick={close}
            style={{
              color: '#374151', fontSize: 18, lineHeight: 1,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px 6px', borderRadius: 6,
            }}
            aria-label="Close tour"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '22px 24px 18px', minHeight: 180 }}>
          {current.body}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid #2A2D3E', padding: '14px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>

          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {STEPS.map((_, i) => (
              <span key={i} style={{
                height: 7,
                width: i === step ? 22 : 7,
                borderRadius: 999,
                background: i === step ? '#3B82F6' : i < step ? '#1D4ED8' : '#1E2130',
                transition: 'all 0.25s ease',
                display: 'inline-block',
              }} />
            ))}
          </div>

          {/* Navigation buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {isFirst ? (
              <button
                onClick={close}
                style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  background: 'transparent', border: '1px solid #1E2130',
                  color: '#4B5563', cursor: 'pointer',
                }}
              >
                Skip
              </button>
            ) : (
              <button
                onClick={() => setStep((s) => s - 1)}
                style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  background: 'transparent', border: '1px solid #2A2D3E',
                  color: '#94A3B8', cursor: 'pointer',
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={() => (isLast ? close() : setStep((s) => s + 1))}
              style={{
                padding: '8px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: '#3B82F6', border: 'none', color: '#fff', cursor: 'pointer',
              }}
            >
              {isLast ? 'Get Started' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
