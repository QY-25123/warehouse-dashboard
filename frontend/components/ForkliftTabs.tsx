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
    <div className="flex flex-col" style={{ color: '#FAF0FF' }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-col gap-4 px-4 py-5 sm:px-6 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderBottom: '1px solid #2D293D', background: '#1D1A26' }}
      >
        {/* Left: title */}
        <div className="flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="#22D3EE20" />
            <rect x="4" y="10" width="14" height="10" rx="1.5" fill="#22D3EE" />
            <rect x="18" y="14" width="6" height="2" rx="1" fill="#22D3EE" />
            <rect x="6" y="20" width="4" height="4" rx="2" fill="#67E8F9" />
            <rect x="14" y="20" width="4" height="4" rx="2" fill="#67E8F9" />
          </svg>
          <div>
            <h1
              className="font-semibold tracking-widest"
              style={{ fontSize: 14, letterSpacing: '0.12em', color: '#FAF0FF' }}
            >
              OPERATIONS CENTER
            </h1>
            <p style={{ fontSize: 11, color: '#9E9AAA', marginTop: 2 }}>
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
                background: '#252033',
                border: '1px solid #2D293D',
                fontSize: 12,
                fontWeight: 500,
                color: '#9E9AAA',
                fontVariantNumeric: mono ? 'tabular-nums' : undefined,
              }}
            >
              <span>{icon}</span>
              <span style={{ color: '#FAF0FF' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab toggle ──────────────────────────────────────────────────────── */}
      <div className="px-4 pt-5 sm:px-6">
        <div
          className="flex w-fit gap-1 rounded-xl p-1"
          style={{ background: '#252033', border: '1px solid #2D293D' }}
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
                  ? { background: '#FB923C', color: '#13111A' }
                  : { background: 'transparent', color: '#9E9AAA' }
              }
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-5 sm:px-6">
        {tab === 'map' ? (
          <ForkliftMap initialForklifts={initialForklifts} onFleetChange={setLiveForklifts} />
        ) : (
          <ForkliftHeatmap />
        )}
      </div>
    </div>
  );
}
