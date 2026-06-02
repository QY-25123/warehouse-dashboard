'use client';

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import type { Forklift, WsMessage } from '@/lib/types';
import { api } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Props {
  initialForklifts: Forklift[];
  onFleetChange?: (forklifts: Forklift[]) => void;
}

// ── Visual constants ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<Forklift['status'], string> = {
  idle:          '#374151',
  moving_empty:  '#93C5FD',
  moving_loaded: '#1D4ED8',
  loading:       '#10B981',
  error:         '#EF4444',
};

// Label text colors — always light enough to read on the dark pill background.
// Idle and moving_loaded body fills are too dark to use directly as text.
const LABEL_COLOR: Record<Forklift['status'], string> = {
  idle:          '#9CA3AF',
  moving_empty:  '#93C5FD',
  moving_loaded: '#60A5FA',
  loading:       '#10B981',
  error:         '#EF4444',
};

const STATUS_LABEL: Record<Forklift['status'], string> = {
  idle:          'Idle',
  moving_empty:  'Moving (empty)',
  moving_loaded: 'Moving (loaded)',
  loading:       'Loading',
  error:         'Error',
};

const STATUS_BADGE_STYLE: Record<Forklift['status'], { bg: string; color: string; border: string; text: string }> = {
  idle:          { bg: '#37415120', color: '#9CA3AF', border: '#37415150', text: 'Idle'    },
  moving_empty:  { bg: '#93C5FD20', color: '#93C5FD', border: '#93C5FD50', text: 'Moving'  },
  moving_loaded: { bg: '#1D4ED820', color: '#60A5FA', border: '#1D4ED850', text: 'Loaded'  },
  loading:       { bg: '#10B98120', color: '#10B981', border: '#10B98150', text: 'Loading' },
  error:         { bg: '#EF444420', color: '#EF4444', border: '#EF444450', text: 'Error'   },
};

// 4×4 shelf zones
const ZONES = (['A', 'B', 'C', 'D'] as const).flatMap((row, ri) =>
  ([1, 2, 3, 4] as const).map((col) => ({
    label: `${row}${col}`,
    x: (col - 1) * 25,
    y: ri * 25,
  }))
);

function coordsToZone(x: number, y: number): string {
  if (x < 0)   return 'DOCK';
  if (x > 100) return 'SHIP';
  if (y > 100) return 'STOR';
  const col = Math.min(Math.floor(x / 25), 3) + 1;
  const row = String.fromCharCode(65 + Math.min(Math.floor(y / 25), 3));
  return `${row}${col}`;
}

// ── SVG Warehouse Floor ───────────────────────────────────────────────────────

function WarehouseFloor() {
  return (
    <>
      {/* Outer shell */}
      <rect x={-1} y={-1} width={102} height={102} rx={2} fill="#141720" stroke="#2A2D3E" strokeWidth={0.4} />

      {/* Rack zone cells with shelf texture */}
      {ZONES.map(({ label, x, y }, i) => (
        <g key={label}>
          <rect x={x + 0.3} y={y + 0.3} width={24.4} height={24.4} fill="#1A1D27" stroke="#252838" strokeWidth={0.3} />
          {/* Shelf lines */}
          {[6, 11, 16, 21].map((oy) => (
            <line key={oy} x1={x + 1} y1={y + oy} x2={x + 24} y2={y + oy}
              stroke="#1E2632" strokeWidth={0.4} />
          ))}
          <text x={x + 2.2} y={y + 4} fontSize={2.8} fill="#6B7280"
            fontWeight="500" letterSpacing="0.1em">
            {label}
          </text>
        </g>
      ))}

      {/* Aisle grid lines */}
      {[25, 50, 75].map((v) => (
        <g key={v}>
          <line x1={v} y1={0} x2={v} y2={100} stroke="#1E2130" strokeWidth={0.5} />
          <line x1={0} y1={v} x2={100} y2={v} stroke="#1E2130" strokeWidth={0.5} />
        </g>
      ))}

      {/* Directional chevrons — horizontal aisles → */}
      {[12.5, 37.5, 62.5, 87.5].map((cy) =>
        [12, 37, 62, 87].map((cx) => (
          <path key={`h-${cx}-${cy}`}
            d={`M${cx},${cy - 0.7} L${cx + 1.4},${cy} L${cx},${cy + 0.7}`}
            fill="none" stroke="#2A3550" strokeWidth={0.4} />
        ))
      )}
      {/* Directional chevrons — vertical aisles ↓ */}
      {[12.5, 37.5, 62.5, 87.5].map((cx) =>
        [12, 37, 62, 87].map((cy) => (
          <path key={`v-${cx}-${cy}`}
            d={`M${cx - 0.7},${cy} L${cx},${cy + 1.4} L${cx + 0.7},${cy}`}
            fill="none" stroke="#2A3550" strokeWidth={0.4} />
        ))
      )}

      {/* DOCK — left */}
      <g>
        <rect x={-16} y={37.5} width={14} height={25} rx={1.5}
          fill="rgba(59,130,246,0.08)" stroke="#3B82F6" strokeWidth={0.5} strokeDasharray="2 1.5" />
        {/* Bay lines */}
        {[-1.5, 0, 1.5].map((dy) => (
          <line key={dy} x1={-16} y1={50 + dy * 3} x2={-14} y2={50 + dy * 3}
            stroke="#3B82F6" strokeWidth={0.6} opacity={0.5} />
        ))}
        {/* Inbound arrow */}
        <path d="M-5,49.2 L-3,50 L-5,50.8" fill="none" stroke="#3B82F6" strokeWidth={0.7} />
        <text x={-9} y={48.5} textAnchor="middle" fontSize={3} fill="#3B82F6" fontWeight="800" letterSpacing="0.05em">DOCK</text>
        <text x={-9} y={52.5} textAnchor="middle" fontSize={1.9} fill="#93C5FD">RECEIVING</text>
      </g>

      {/* SHIP — right */}
      <g>
        <rect x={102} y={37.5} width={14} height={25} rx={1.5}
          fill="rgba(249,115,22,0.08)" stroke="#F97316" strokeWidth={0.5} strokeDasharray="2 1.5" />
        {/* Bay lines */}
        {[-1.5, 0, 1.5].map((dy) => (
          <line key={dy} x1={114} y1={50 + dy * 3} x2={116} y2={50 + dy * 3}
            stroke="#F97316" strokeWidth={0.6} opacity={0.5} />
        ))}
        {/* Outbound arrow */}
        <path d="M105,49.2 L107,50 L105,50.8" fill="none" stroke="#F97316" strokeWidth={0.7} />
        <text x={109} y={48.5} textAnchor="middle" fontSize={3} fill="#F97316" fontWeight="800" letterSpacing="0.05em">SHIP</text>
        <text x={109} y={52.5} textAnchor="middle" fontSize={1.9} fill="#FB923C">SHIPPING</text>
      </g>

      {/* STOR — bottom */}
      <g>
        <rect x={37.5} y={102} width={25} height={14} rx={1.5}
          fill="rgba(139,92,246,0.08)" stroke="#8B5CF6" strokeWidth={0.5} strokeDasharray="2 1.5" />
        {/* Stacked box icons */}
        {[-4, 0, 4].map((dx) => (
          <rect key={dx} x={50 + dx - 1.5} y={106} width={3} height={2.5} rx={0.3}
            fill="none" stroke="#8B5CF680" strokeWidth={0.4} />
        ))}
        <text x={50} y={105} textAnchor="middle" fontSize={3} fill="#8B5CF6" fontWeight="800" letterSpacing="0.05em">STOR</text>
        <text x={50} y={112} textAnchor="middle" fontSize={1.9} fill="#A78BFA">STORAGE</text>
      </g>
    </>
  );
}

// ── Forklift marker ───────────────────────────────────────────────────────────

function ForkliftMarker({
  f,
  prevPos,
  isHovered,
  onEnter,
  onLeave,
}: {
  f: Forklift;
  prevPos: { x: number; y: number } | undefined;
  isHovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const color  = STATUS_COLOR[f.status];
  const dx     = prevPos ? f.x - prevPos.x : 0;
  const dy     = prevPos ? f.y - prevPos.y : 0;
  const moving = Math.abs(dx) + Math.abs(dy) > 0.1;
  const angle  = moving ? (Math.atan2(dy, dx) * 180) / Math.PI + 90 : 0;

  const zone = coordsToZone(f.x, f.y);
  const num  = f.name.replace('FL-', '');

  return (
    <g
      style={{ cursor: 'pointer', transition: 'transform 1.8s ease' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* Error pulsing ring */}
      {f.status === 'error' && (
        <>
          <circle cx={f.x} cy={f.y} r={5.5} fill="none" stroke="#EF4444"
            strokeWidth={0.6} opacity={0.25} className="animate-ping" />
          <circle cx={f.x} cy={f.y} r={4.5} fill="none" stroke="#EF4444"
            strokeWidth={0.5} opacity={0.4} />
        </>
      )}
      {/* Loading glow */}
      {f.status === 'loading' && (
        <circle cx={f.x} cy={f.y} r={4} fill="#10B98115" stroke="#10B981"
          strokeWidth={0.4} opacity={0.6} />
      )}
      {/* Hover ring */}
      {isHovered && (
        <circle cx={f.x} cy={f.y} r={5} fill="none" stroke={color}
          strokeWidth={0.5} opacity={0.6} />
      )}

      {/* Forklift body — rotated rectangle */}
      <g transform={`rotate(${angle}, ${f.x}, ${f.y})`}>
        {/* Body */}
        <rect
          x={f.x - 2.2} y={f.y - 3.2} width={4.4} height={6.4} rx={0.8}
          fill={color} stroke="rgba(255,255,255,0.25)" strokeWidth={0.3}
        />
        {/* Forks at front (top when 0°) */}
        <line x1={f.x - 1.2} y1={f.y - 3.2} x2={f.x - 1.2} y2={f.y - 5}
          stroke={color} strokeWidth={0.7} />
        <line x1={f.x + 1.2} y1={f.y - 3.2} x2={f.x + 1.2} y2={f.y - 5}
          stroke={color} strokeWidth={0.7} />
        {/* Cargo pallet for moving_loaded */}
        {f.status === 'moving_loaded' && (
          <rect x={f.x - 1.5} y={f.y - 5.8} width={3} height={2.5} rx={0.3}
            fill="#F97316" stroke="rgba(255,255,255,0.3)" strokeWidth={0.3} />
        )}
      </g>

      {/* ID label pill */}
      <rect x={f.x - 3.2} y={f.y + 3.8} width={6.4} height={2.8} rx={1.4}
        fill="rgba(15,17,23,0.75)" />
      <text x={f.x} y={f.y + 5.6} textAnchor="middle" fontSize={2}
        fill={LABEL_COLOR[f.status]} fontWeight="600">
        {num}
      </text>
    </g>
  );
}

// ── SVG Tooltip ───────────────────────────────────────────────────────────────

function MapTooltip({ f, tx, ty }: { f: Forklift; tx: number; ty: number }) {
  const zone  = coordsToZone(f.x, f.y);
  const badge = STATUS_BADGE_STYLE[f.status];
  return (
    <g pointerEvents="none">
      <rect x={tx} y={ty} width={34} height={16} rx={2}
        fill="#1A1D27" stroke="#2A2D3E" strokeWidth={0.4}
        filter="drop-shadow(0 2px 8px rgba(0,0,0,0.6))" />
      <text x={tx + 2.5} y={ty + 4.5} fontSize={2.8} fill="#F1F5F9" fontWeight="700">
        {f.name}
      </text>
      <text x={tx + 2.5} y={ty + 8.2} fontSize={2.1} fill="#94A3B8">
        {STATUS_LABEL[f.status]}
      </text>
      <text x={tx + 2.5} y={ty + 11.5} fontSize={2.1} fill="#94A3B8">
        Zone: {zone}
      </text>
      <text x={tx + 2.5} y={ty + 14.8} fontSize={1.8} fill="#64748B">
        {f.x.toFixed(1)}, {f.y.toFixed(1)}
      </text>
    </g>
  );
}

// ── Fleet Status donut ────────────────────────────────────────────────────────

function DonutChart({ counts, total }: { counts: { status: Forklift['status']; count: number }[]; total: number }) {
  const R = 28;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const slices = counts
    .filter((c) => c.count > 0)
    .map((c) => {
      const frac  = c.count / Math.max(total, 1);
      const dash  = frac * C;
      const gap   = C - dash;
      const slice = { status: c.status, dash, gap, offset };
      offset += dash;
      return slice;
    });

  return (
    <svg width={80} height={80} viewBox="0 0 80 80">
      <circle cx={40} cy={40} r={R} fill="none" stroke="#1E2130" strokeWidth={10} />
      {slices.map((s) => (
        <circle
          key={s.status}
          cx={40} cy={40} r={R}
          fill="none"
          stroke={STATUS_COLOR[s.status]}
          strokeWidth={10}
          strokeDasharray={`${s.dash} ${s.gap}`}
          strokeDashoffset={C / 4 - s.offset}
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
      ))}
      <text x={40} y={37} textAnchor="middle" fontSize={11}
        fill="#F1F5F9" fontWeight="700">
        {total}
      </text>
      <text x={40} y={49} textAnchor="middle" fontSize={7} fill="#94A3B8">
        units
      </text>
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ForkliftMap({ initialForklifts, onFleetChange }: Props) {
  const [forklifts, setForklifts] = useState<Map<number, Forklift>>(
    () => new Map(initialForklifts.map((f) => [f.id, f]))
  );
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const prevPositions = useRef<Map<number, { x: number; y: number }>>(new Map());

  useEffect(() => {
    onFleetChange?.(Array.from(forklifts.values()));
  }, [forklifts, onFleetChange]);

  useEffect(() => {
    api.forklifts.list()
      .then((data) => setForklifts(new Map(data.map((f) => [f.id, f]))))
      .catch(() => {});
  }, []);

  const onMessage = useCallback((msg: WsMessage) => {
    if (msg.type !== 'forklift_update') return;
    setForklifts((prev) => {
      const existing = prev.get(msg.payload.id);
      if (existing) {
        prevPositions.current.set(msg.payload.id, { x: existing.x, y: existing.y });
      }
      const next = new Map(prev);
      next.set(msg.payload.id, {
        ...(existing ?? {}),
        ...msg.payload,
        last_updated: new Date().toISOString(),
      } as Forklift);
      return next;
    });
  }, []);

  const { connected } = useWebSocket({ onMessage });

  const items  = Array.from(forklifts.values());
  const sorted = [...items].sort((a, b) => {
    // Error forklifts float to top
    if (a.status === 'error' && b.status !== 'error') return -1;
    if (b.status === 'error' && a.status !== 'error') return  1;
    return a.id - b.id;
  });

  const hovered = hoveredId != null ? forklifts.get(hoveredId) : undefined;
  const tx = hovered ? (hovered.x > 64 ? Math.max(hovered.x - 36, -16) : Math.min(hovered.x + 4, 80)) : 0;
  const ty = hovered ? Math.max(Math.min(hovered.y - 8, 104), -2) : 0;

  const counts = (Object.keys(STATUS_COLOR) as Forklift['status'][]).map((s) => ({
    status: s,
    count: items.filter((f) => f.status === s).length,
  }));
  const total = items.length;

  const panelStyle: CSSProperties = {
    background: '#1A1D27',
    border: '1px solid #2A2D3E',
    borderRadius: 12,
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  };

  return (
    <div className="space-y-4">
      {/* Live badge */}
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${connected ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: connected ? '#10B981' : '#EF4444' }} />
        <span style={{ fontSize: 12, color: '#94A3B8' }}>
          {connected ? 'Live — updating every 2 s' : 'Reconnecting…'}
        </span>
      </div>

      <div className="flex flex-col gap-5" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {/* ── SVG map ─────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 overflow-hidden" style={{ ...panelStyle, minWidth: 520 }}>
          <svg
            viewBox="-18 -2 136 122"
            className="w-full"
            style={{ maxHeight: 580, display: 'block' }}
            onMouseLeave={() => setHoveredId(null)}
            aria-label="Warehouse floor map"
          >
            <WarehouseFloor />

            {items.map((f) => (
              <ForkliftMarker
                key={f.id}
                f={f}
                prevPos={prevPositions.current.get(f.id)}
                isHovered={hoveredId === f.id}
                onEnter={() => setHoveredId(f.id)}
                onLeave={() => setHoveredId(null)}
              />
            ))}

            {hovered && (
              <MapTooltip f={hovered} tx={tx} ty={ty} />
            )}
          </svg>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4" style={{ width: 260, flexShrink: 0 }}>

          {/* Fleet Status card */}
          <div style={{ ...panelStyle, padding: '16px' }}>
            <h2 style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: '#94A3B8', marginBottom: 14 }}>
              FLEET STATUS
            </h2>
            <div className="flex items-center gap-4 mb-4">
              <DonutChart counts={counts} total={total} />
              <div className="flex-1 text-right">
                <div style={{ fontSize: 28, fontWeight: 700, color: '#F1F5F9', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {total}
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>forklifts</div>
              </div>
            </div>
            <div className="space-y-2">
              {counts.map(({ status, count }) => {
                const pct = total > 0 ? (count / total) * 100 : 0;
                const col = STATUS_COLOR[status];
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: col }} />
                        <span style={{ fontSize: 12, color: '#94A3B8' }}>
                          {STATUS_LABEL[status]}
                        </span>
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#F1F5F9', fontVariantNumeric: 'tabular-nums' }}>
                        {count}
                      </span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: '#0F1117', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        backgroundColor: col,
                        borderRadius: 2,
                        transition: 'width 0.4s ease',
                        opacity: count === 0 ? 0.2 : 1,
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fleet Roster card */}
          <div style={{ ...panelStyle, padding: '16px', overflow: 'hidden' }}>
            <h2 style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: '#94A3B8', marginBottom: 12 }}>
              FLEET ROSTER
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sorted.map((f, i) => {
                const badge  = STATUS_BADGE_STYLE[f.status];
                const isErr  = f.status === 'error';
                const isHov  = hoveredId === f.id;
                const zone   = coordsToZone(f.x, f.y);
                return (
                  <button
                    key={f.id}
                    onMouseEnter={() => setHoveredId(f.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: isErr ? '1px solid #EF444440' : '1px solid transparent',
                      borderTop: isErr ? '2px solid #EF4444' : undefined,
                      background: isHov ? '#2A2D3E' : i % 2 === 0 ? '#0F111780' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.15s',
                      width: '100%',
                    }}
                  >
                    <span className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: STATUS_COLOR[f.status] }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#F1F5F9', flex: 1 }}>
                      {f.name}
                    </span>
                    {/* Zone pill */}
                    <span style={{
                      fontSize: 10, fontWeight: 500, color: '#94A3B8',
                      background: '#0F1117', border: '1px solid #2A2D3E',
                      borderRadius: 4, padding: '1px 5px',
                    }}>
                      {zone}
                    </span>
                    {/* Status badge */}
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      color: badge.color,
                      background: badge.bg,
                      border: `1px solid ${badge.border}`,
                      borderRadius: 999,
                      padding: '1px 7px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}>
                      {isErr && <span style={{ fontSize: 9 }}>⚠</span>}
                      {badge.text}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
