'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { getClientToken } from '@/lib/client-auth';

const REFRESH_MS = 30_000;

// 11 rows × 4 cols = 44 zones. Each row is 10 SVG units tall, each col 25 wide.
const GRID_ZONES = (['A','B','C','D','E','F','G','H','I','J','K'] as const).flatMap((row, ri) =>
  ([1, 2, 3, 4] as const).map((col) => ({
    label: `${row}${col}`,
    x: (col - 1) * 25,
    y: ri * 10,
    w: 25, h: 10,
  }))
);

const SPECIAL_ZONES = [
  { label: 'DOCK', sublabel: 'RECEIVING', x: -16, y: 40,  w: 14, h: 30, accent: '#3B82F6' },
  { label: 'SHIP', sublabel: 'SHIPPING',  x: 102, y: 40,  w: 14, h: 30, accent: '#F97316' },
  { label: 'STOR', sublabel: 'STORAGE',   x: 37.5, y: 112, w: 25, h:  8, accent: '#8B5CF6' },
] as const;


function intensityToColor(t: number): string {
  if (t <= 0) return '#1A1D27';
  const stops: [number, [number, number, number]][] = [
    [0,    [26,  29,  39]],
    [0.15, [30,  58,  95]],
    [0.4,  [29,  78, 216]],
    [0.65, [217,119,   6]],
    [1,    [220, 38,  38]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const r = (t - t0) / (t1 - t0);
      return `rgb(${Math.round(c0[0]+r*(c1[0]-c0[0]))},${Math.round(c0[1]+r*(c1[1]-c0[1]))},${Math.round(c0[2]+r*(c1[2]-c0[2]))})`;
    }
  }
  return 'rgb(220,38,38)';
}

function tooltipPos(label: string): { tx: number; ty: number } {
  const gz = GRID_ZONES.find((z) => z.label === label);
  if (gz) return { tx: gz.x > 50 ? gz.x - 34 : gz.x + 27, ty: Math.max(gz.y - 2, 1) };
  const sz = SPECIAL_ZONES.find((z) => z.label === label);
  if (sz) {
    const re = sz.x + sz.w;
    return { tx: re > 80 ? sz.x - 34 : re + 2, ty: Math.max(sz.y - 2, -1) };
  }
  return { tx: 10, ty: 10 };
}

export function ForkliftHeatmap() {
  const [counts, setCounts]           = useState<Map<string, number>>(new Map());
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [hovered, setHovered]         = useState<{ label: string; count: number } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const token = await getClientToken();
        const data = await api.events.heatmap(500, token);
        const map = new Map(Object.entries(data));
        setCounts(map);
        setTotal(Object.values(data).reduce((a, b) => a + b, 0));
        setLastRefresh(new Date());
      } catch {
        // retain stale data
      } finally {
        setLoading(false);
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const maxCount = Math.max(1, ...Array.from(counts.values()));

  const panelStyle: CSSProperties = {
    background: '#1A1D27',
    border: '1px solid #2A2D3E',
    borderRadius: 12,
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" style={{ color: '#94A3B8', fontSize: 14 }}>
        Loading heatmap data…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4" style={{ fontSize: 12, color: '#94A3B8' }}>
        <span>{total} position events analysed</span>
        {lastRefresh && <span>Refreshes every 30 s · last at {lastRefresh.toLocaleTimeString()}</span>}
      </div>

      <div className="flex flex-col gap-5" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {/* SVG heatmap */}
        <div className="min-w-0 flex-1 overflow-hidden" style={{ ...panelStyle, minWidth: 400 }}>
          <svg viewBox="-18 -2 136 128" className="w-full" style={{ display: 'block' }}>
            {/* Outer shell */}
            <rect x={-1} y={-1} width={102} height={112} rx={2}
              fill="#141720" stroke="#2A2D3E" strokeWidth={0.4} />

            {/* Grid zones */}
            {GRID_ZONES.map(({ label, x, y }) => {
              const count = counts.get(label) ?? 0;
              const norm  = count / maxCount;
              const fill  = intensityToColor(norm);
              const light = norm > 0.5;
              return (
                <g key={label} style={{ cursor: 'default' }}
                  onMouseEnter={() => setHovered({ label, count })}
                  onMouseLeave={() => setHovered(null)}>
                  <rect x={x + 0.2} y={y + 0.2} width={24.6} height={9.6}
                    fill={fill} stroke="#252838" strokeWidth={0.2} />
                  {norm < 0.3 && (
                    <line x1={x + 1} y1={y + 5} x2={x + 24} y2={y + 5}
                      stroke="#1E2632" strokeWidth={0.3} />
                  )}
                  <text x={x + 12.5} y={y + 3.8} textAnchor="middle"
                    fontSize={2.5} fontWeight="700" letterSpacing="0.05em"
                    fill={light ? 'rgba(255,255,255,0.9)' : '#94A3B8'}>
                    {label}
                  </text>
                  <text x={x + 12.5} y={y + 7.5} textAnchor="middle"
                    fontSize={2.2} fill={light ? 'rgba(255,255,255,0.7)' : '#6B7280'}>
                    {count > 0 ? `${count}` : '—'}
                  </text>
                </g>
              );
            })}

            {/* Aisle lines */}
            {[25, 50, 75].map((v) => (
              <line key={`vl${v}`} x1={v} y1={0} x2={v} y2={110} stroke="#1E2130" strokeWidth={0.4} />
            ))}
            {[10,20,30,40,50,60,70,80,90,100].map((v) => (
              <line key={`hl${v}`} x1={0} y1={v} x2={100} y2={v} stroke="#1E2130" strokeWidth={0.4} />
            ))}

            {/* Special zones */}
            {SPECIAL_ZONES.map((sz) => {
              const count = counts.get(sz.label) ?? 0;
              const norm  = count / maxCount;
              const fill  = count > 0 ? intensityToColor(norm) : 'transparent';
              const light = norm > 0.5;
              const cx    = sz.x + sz.w / 2;
              const cy    = sz.y + sz.h / 2;
              return (
                <g key={sz.label} style={{ cursor: 'default' }}
                  onMouseEnter={() => setHovered({ label: sz.label, count })}
                  onMouseLeave={() => setHovered(null)}>
                  <rect x={sz.x} y={sz.y} width={sz.w} height={sz.h} rx={1.5}
                    fill={fill} stroke={sz.accent} strokeWidth={0.5} strokeDasharray="2 1.5" />
                  <text x={cx} y={cy - 1.5} textAnchor="middle" dominantBaseline="middle"
                    fontSize={sz.label === 'STOR' ? 2.5 : 2.8} fontWeight="800" letterSpacing="0.05em"
                    fill={light ? 'rgba(255,255,255,0.95)' : sz.accent}>
                    {sz.label}
                  </text>
                  <text x={cx} y={cy + 1.8} textAnchor="middle" dominantBaseline="middle"
                    fontSize={1.7} fill={light ? 'rgba(255,255,255,0.7)' : sz.accent}>
                    {count > 0 ? `${count} visits` : sz.sublabel}
                  </text>
                </g>
              );
            })}

            {/* Tooltip */}
            {hovered && (() => {
              const { tx, ty } = tooltipPos(hovered.label);
              const isSpecial  = ['DOCK','SHIP','STOR'].includes(hovered.label);
              return (
                <g pointerEvents="none">
                  <rect x={tx} y={ty} width={34} height={12} rx={2}
                    fill="#1A1D27" stroke="#2A2D3E" strokeWidth={0.4}
                    filter="drop-shadow(0 2px 8px rgba(0,0,0,0.6))" />
                  <text x={tx+2.5} y={ty+4.5} fontSize={2.6} fill="#F1F5F9" fontWeight="700">
                    {isSpecial ? hovered.label : `Zone ${hovered.label}`}
                  </text>
                  <text x={tx+2.5} y={ty+8.5} fontSize={2} fill="#94A3B8">
                    {hovered.count} visits · {((hovered.count/maxCount)*100).toFixed(0)}% of peak
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4" style={{ width: 260, flexShrink: 0 }}>
          {/* Gradient legend */}
          <div style={{ ...panelStyle, padding: 16 }}>
            <h2 style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: '#94A3B8', marginBottom: 12 }}>
              TRAFFIC INTENSITY
            </h2>
            <div style={{
              height: 12, borderRadius: 6,
              background: 'linear-gradient(to right, #1A1D27, #1E3A5F, #1D4ED8, #D97706, #DC2626)',
            }} />
            <div className="flex justify-between mt-1" style={{ fontSize: 10, color: '#94A3B8' }}>
              <span>Empty</span><span>Low</span><span>Mid</span><span>High</span><span>Peak</span>
            </div>
          </div>

          {/* Busiest zones */}
          <div style={{ ...panelStyle, padding: 16 }}>
            <h2 style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: '#94A3B8', marginBottom: 12 }}>
              BUSIEST ZONES
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([label, count], i) => {
                  const norm = count / maxCount;
                  const col  = intensityToColor(norm);
                  return (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', width: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {i + 1}
                      </span>
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, backgroundColor: col, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#F1F5F9', width: 32 }}>{label}</span>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#0F1117', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 2, width: `${norm*100}%`, backgroundColor: col, transition: 'width 0.4s ease' }} />
                      </div>
                      <span style={{ fontSize: 11, color: '#94A3B8', fontVariantNumeric: 'tabular-nums', width: 24, textAlign: 'right' }}>
                        {count}
                      </span>
                    </div>
                  );
                })}
              {counts.size === 0 && (
                <p style={{ fontSize: 12, color: '#94A3B8' }}>No position data yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
