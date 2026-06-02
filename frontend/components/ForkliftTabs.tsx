'use client';

import { useState, useEffect } from 'react';
import type { Forklift } from '@/lib/types';
import { ForkliftMap } from '@/components/ForkliftMap';
import { ForkliftHeatmap } from '@/components/ForkliftHeatmap';

type Tab = 'map' | 'heatmap';

interface Props {
  initialForklifts: Forklift[];
}

export function ForkliftTabs({ initialForklifts }: Props) {
  const [tab, setTab] = useState<Tab>('map');
  const [clock, setClock] = useState('');
  const [liveForklifts, setLiveForklifts] = useState<Forklift[]>(initialForklifts);

  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const total  = liveForklifts.length;
  const active = liveForklifts.filter(
    (f) => f.status === 'moving_empty' || f.status === 'moving_loaded' || f.status === 'loading',
  ).length;

  return (
    <div className="flex flex-col" style={{ color: '#F1F5F9' }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderBottom: '1px solid #2A2D3E', background: '#1A1D27' }}
      >
        {/* Left: title */}
        <div className="flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="#3B82F620" />
            <rect x="4" y="10" width="14" height="10" rx="1.5" fill="#3B82F6" />
            <rect x="18" y="14" width="6" height="2" rx="1" fill="#3B82F6" />
            <rect x="6" y="20" width="4" height="4" rx="2" fill="#93C5FD" />
            <rect x="14" y="20" width="4" height="4" rx="2" fill="#93C5FD" />
          </svg>
          <div>
            <h1
              className="font-semibold tracking-widest"
              style={{ fontSize: 14, letterSpacing: '0.12em', color: '#F1F5F9' }}
            >
              OPERATIONS CENTER
            </h1>
            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
              Live Forklift Tracking · Updates every 2s
            </p>
          </div>
          <div className="ml-3 flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full animate-pulse"
              style={{ backgroundColor: '#10B981' }}
            />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#10B981', letterSpacing: '0.08em' }}>
              LIVE
            </span>
          </div>
        </div>

        {/* Right: stat chips */}
        <div className="flex flex-wrap gap-2">
          {[
            { icon: '🏭', label: `${total} Forklifts` },
            { icon: '✅', label: `${active} Active` },
            { icon: '🕐', label: clock, mono: true },
          ].map(({ icon, label, mono }) => (
            <div
              key={label + icon}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5"
              style={{
                background: '#0F1117',
                border: '1px solid #2A2D3E',
                fontSize: 12,
                fontWeight: 500,
                color: '#94A3B8',
                fontVariantNumeric: mono ? 'tabular-nums' : undefined,
              }}
            >
              <span>{icon}</span>
              <span style={{ color: '#F1F5F9' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab toggle ──────────────────────────────────────────────────────── */}
      <div className="px-6 pt-5">
        <div
          className="flex w-fit gap-1 rounded-xl p-1"
          style={{ background: '#0F1117', border: '1px solid #2A2D3E' }}
        >
          {([
            { id: 'map' as Tab,     icon: '📍', label: 'Live Map'        },
            { id: 'heatmap' as Tab, icon: '🔥', label: 'Traffic Heatmap' },
          ]).map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all"
              style={
                tab === id
                  ? { background: '#3B82F6', color: '#fff' }
                  : { background: 'transparent', color: '#94A3B8' }
              }
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div className="px-6 py-5">
        {tab === 'map' ? (
          <ForkliftMap initialForklifts={initialForklifts} onFleetChange={setLiveForklifts} />
        ) : (
          <ForkliftHeatmap />
        )}
      </div>
    </div>
  );
}
