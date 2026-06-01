'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const REFRESH_MS = 30_000;

// ── Grid zones — 4×4 shelf area, same coordinate space as ForkliftMap ─────────
const GRID_ZONES = (['A', 'B', 'C', 'D'] as const).flatMap((row, ri) =>
  ([1, 2, 3, 4] as const).map((col) => ({
    label: `${row}${col}`,
    x: (col - 1) * 25,
    y: ri * 25,
    w: 25, h: 25,
  }))
);

// Special zones sit OUTSIDE the 0-100 grid (same layout as ForkliftMap).
// Forklift backend coords: DOCK=(-10,50) SHIP=(110,50) STOR=(50,110)
const SPECIAL_ZONES = [
  { label: 'DOCK', sublabel: 'Receiving', x: -16, y: 37.5, w: 14, h: 25,
    baseFill: '#DBEAFE', stroke: '#93C5FD', labelFill: '#1E40AF', sublabelFill: '#3B82F6' },
  { label: 'SHIP', sublabel: 'Shipping',  x: 102, y: 37.5, w: 14, h: 25,
    baseFill: '#FFEDD5', stroke: '#FDBA74', labelFill: '#9A3412', sublabelFill: '#EA580C' },
  { label: 'STOR', sublabel: 'Storage',   x: 37.5, y: 102, w: 25, h: 14,
    baseFill: '#F3E8FF', stroke: '#C084FC', labelFill: '#6B21A8', sublabelFill: '#9333EA' },
] as const;

// ── Zone detection — mirrors simulator._xy_to_zone exactly ───────────────────
function coordsToZone(x: unknown, y: unknown): string {
  const nx = Number(x);
  const ny = Number(y);
  if (!isFinite(nx) || !isFinite(ny)) return '';
  if (nx < 0)   return 'DOCK';
  if (nx > 100) return 'SHIP';
  if (ny > 100) return 'STOR';
  const col = Math.floor(Math.min(Math.max(nx, 0), 99.9) / 25) + 1;
  const row = String.fromCharCode(65 + Math.floor(Math.min(Math.max(ny, 0), 99.9) / 25));
  return `${row}${col}`;
}

// Heat gradient: cool blue → yellow → orange → red
function intensityToColor(t: number): string {
  if (t <= 0) return '#F8FAFC';
  const stops: [number, [number, number, number]][] = [
    [0,    [219, 234, 254]],
    [0.25, [254, 249, 195]],
    [0.5,  [253, 230, 138]],
    [0.75, [251, 146,  60]],
    [1,    [239,  68,  68]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const r = (t - t0) / (t1 - t0);
      return `rgb(${Math.round(c0[0] + r * (c1[0] - c0[0]))},${Math.round(c0[1] + r * (c1[1] - c0[1]))},${Math.round(c0[2] + r * (c1[2] - c0[2]))})`;
    }
  }
  return 'rgb(239,68,68)';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ForkliftHeatmap() {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const events = await api.events.list({ limit: 500 });
        const map = new Map<string, number>();
        for (const ev of events) {
          const zone = coordsToZone(ev.payload.x, ev.payload.y);
          if (zone) map.set(zone, (map.get(zone) ?? 0) + 1);
        }
        setCounts(map);
        setTotal(Array.from(map.values()).reduce((a, b) => a + b, 0));
        setLastRefresh(new Date());
      } catch {
        // silently retain stale data
      } finally {
        setLoading(false);
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const maxCount = Math.max(1, ...Array.from(counts.values()));
  const [hovered, setHovered] = useState<{ label: string; count: number } | null>(null);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        Loading heatmap data…
      </div>
    );
  }

  function tooltipPos(label: string): { tx: number; ty: number } {
    const gz = GRID_ZONES.find((z) => z.label === label);
    if (gz) {
      return {
        tx: gz.x > 50 ? gz.x - 32 : gz.x + 27,
        ty: Math.max(gz.y - 2, 1),
      };
    }
    const sz = SPECIAL_ZONES.find((z) => z.label === label);
    if (sz) {
      const rightEdge = sz.x + sz.w;
      const tx = rightEdge > 80 ? sz.x - 32 : rightEdge + 2;
      return { tx, ty: Math.max(sz.y - 2, -1) };
    }
    return { tx: 10, ty: 10 };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
        <span>{total} position events analysed</span>
        {lastRefresh && (
          <span>Refreshes every 30 s · last at {lastRefresh.toLocaleTimeString()}</span>
        )}
      </div>

      <div className="flex flex-col gap-6 xl:flex-row">
        {/* ── SVG heatmap (same extended viewBox as ForkliftMap) ─────────── */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <svg
            viewBox="-18 -2 136 122"
            className="w-full"
            style={{ maxHeight: 560, display: 'block' }}
          >
            {/* ── A1-D4 grid ───────────────────────────────────────────── */}
            {GRID_ZONES.map(({ label, x, y }) => {
              const count = counts.get(label) ?? 0;
              const norm  = count / maxCount;
              const fill  = intensityToColor(norm);
              const isHot = norm > 0.6;
              return (
                <g
                  key={label}
                  style={{ cursor: 'default' }}
                  onMouseEnter={() => setHovered({ label, count })}
                  onMouseLeave={() => setHovered(null)}
                >
                  <rect x={x} y={y} width={25} height={25}
                    fill={fill} stroke="#CBD5E1" strokeWidth={0.2} />
                  <text x={x + 12.5} y={y + 10} textAnchor="middle"
                    fontSize={3.5} fontWeight="700"
                    fill={isHot ? 'rgba(255,255,255,0.9)' : '#64748B'}
                    letterSpacing="0.05em">
                    {label}
                  </text>
                  <text x={x + 12.5} y={y + 16} textAnchor="middle"
                    fontSize={3} fill={isHot ? 'rgba(255,255,255,0.75)' : '#94A3B8'}>
                    {count} visits
                  </text>
                </g>
              );
            })}

            {/* ── Special zone panels (DOCK / SHIP / STOR) ─────────────── */}
            {SPECIAL_ZONES.map((sz) => {
              const count = counts.get(sz.label) ?? 0;
              const norm  = count / maxCount;
              const fill  = count > 0 ? intensityToColor(norm) : sz.baseFill;
              const isHot = norm > 0.6;
              const cx    = sz.x + sz.w / 2;
              const cy    = sz.y + sz.h / 2;
              return (
                <g
                  key={sz.label}
                  style={{ cursor: 'default' }}
                  onMouseEnter={() => setHovered({ label: sz.label, count })}
                  onMouseLeave={() => setHovered(null)}
                >
                  <rect x={sz.x} y={sz.y} width={sz.w} height={sz.h}
                    fill={fill} stroke={sz.stroke} strokeWidth={0.5} rx={1.5} />
                  <text x={cx} y={cy - 2.5} textAnchor="middle" dominantBaseline="middle"
                    fontSize={sz.label === 'STOR' ? 3.0 : 3.2} fontWeight="800"
                    fill={isHot ? 'rgba(255,255,255,0.95)' : sz.labelFill}
                    letterSpacing="0.05em">
                    {sz.label}
                  </text>
                  <text x={cx} y={cy + 2.5} textAnchor="middle" dominantBaseline="middle"
                    fontSize={sz.label === 'STOR' ? 1.9 : 2.0}
                    fill={isHot ? 'rgba(255,255,255,0.75)' : sz.sublabelFill}>
                    {count} visits
                  </text>
                </g>
              );
            })}

            {/* ── Tooltip ──────────────────────────────────────────────── */}
            {hovered && (() => {
              const { tx, ty } = tooltipPos(hovered.label);
              const isSpecial = ['DOCK', 'SHIP', 'STOR'].includes(hovered.label);
              return (
                <g pointerEvents="none">
                  <rect x={tx} y={ty} width={30} height={10} rx={1.5}
                    fill="white" stroke="#CBD5E1" strokeWidth={0.3}
                    filter="drop-shadow(0 1px 3px rgba(0,0,0,0.12))" />
                  <text x={tx + 2} y={ty + 4} fontSize={2.4} fill="#111827" fontWeight="700">
                    {isSpecial ? hovered.label : `Zone ${hovered.label}`}
                  </text>
                  <text x={tx + 2} y={ty + 7.5} fontSize={2} fill="#6B7280">
                    {hovered.count} visits · {((hovered.count / maxCount) * 100).toFixed(0)}% of peak
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>

        {/* ── Gradient legend + zone ranking ────────────────────────────── */}
        <div className="flex w-full flex-col gap-4 xl:w-56">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Traffic Intensity
            </h2>
            <div
              className="h-4 w-full rounded-full"
              style={{
                background:
                  'linear-gradient(to right, rgb(219,234,254), rgb(254,249,195), rgb(253,230,138), rgb(251,146,60), rgb(239,68,68))',
              }}
            />
            <div className="mt-1 flex justify-between text-[10px] text-gray-400">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Busiest Zones
            </h2>
            <div className="space-y-1.5">
              {Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([label, count]) => (
                  <div key={label} className="flex items-center gap-2 text-sm">
                    <span
                      className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                      style={{ backgroundColor: intensityToColor(count / maxCount) }}
                    />
                    <span className="font-mono text-xs text-gray-700">{label}</span>
                    <div className="flex-1 overflow-hidden rounded-full bg-gray-100" style={{ height: 4 }}>
                      <div
                        className="h-full rounded-full bg-orange-400 transition-all"
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-xs text-gray-500">{count}</span>
                  </div>
                ))}
              {counts.size === 0 && (
                <p className="text-xs text-gray-400">No position data yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
