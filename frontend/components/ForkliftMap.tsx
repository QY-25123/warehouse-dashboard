'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Forklift, WsMessage } from '@/lib/types';
import { api } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Props {
  initialForklifts: Forklift[];
}

// ── Visual constants ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<Forklift['status'], string> = {
  idle:          '#9CA3AF', // gray
  moving_empty:  '#93C5FD', // light blue — travelling, no cargo
  moving_loaded: '#1D4ED8', // dark blue  — travelling, carrying cargo
  loading:       '#22C55E', // green
  error:         '#EF4444', // red
};

const STATUS_LABEL: Record<Forklift['status'], string> = {
  idle:          'Idle',
  moving_empty:  'Moving (empty)',
  moving_loaded: 'Moving (loaded)',
  loading:       'Loading',
  error:         'Error',
};

const STATUS_BADGE: Record<Forklift['status'], string> = {
  idle:          'bg-gray-100 text-gray-700 border-gray-200',
  moving_empty:  'bg-blue-100 text-blue-600 border-blue-200',
  moving_loaded: 'bg-blue-200 text-blue-900 border-blue-400',
  loading:       'bg-green-100 text-green-700 border-green-200',
  error:         'bg-red-100 text-red-700 border-red-200',
};

// 4×4 warehouse shelf zones — each 25×25 SVG units, occupying the 0-100 grid.
const ZONES = (['A', 'B', 'C', 'D'] as const).flatMap((row, ri) =>
  ([1, 2, 3, 4] as const).map((col) => ({
    label: `${row}${col}`,
    x: (col - 1) * 25,
    y: ri * 25,
  }))
);

const ZONE_FILLS = ['#F8FAFC', '#F1F5F9'];

// Special zones sit OUTSIDE the main 0-100 grid in the extended SVG space.
// Their visual rects are placed adjacent to the grid edges with a 2-unit gap.
// Forklift backend coords: DOCK=(-10,50) SHIP=(110,50) STOR=(50,110)
const SPECIAL_ZONES = [
  {
    label:       'DOCK',
    sublabel:    'Receiving',
    rx: -16, ry: 37.5, rw: 14, rh: 25,   // rect in extended SVG space
    fill: '#DBEAFE', stroke: '#93C5FD',
    labelFill: '#1E40AF', sublabelFill: '#3B82F6',
  },
  {
    label:       'SHIP',
    sublabel:    'Shipping',
    rx: 102, ry: 37.5, rw: 14, rh: 25,
    fill: '#FFEDD5', stroke: '#FDBA74',
    labelFill: '#9A3412', sublabelFill: '#EA580C',
  },
  {
    label:       'STOR',
    sublabel:    'Storage',
    rx: 37.5, ry: 102, rw: 25, rh: 14,
    fill: '#F3E8FF', stroke: '#C084FC',
    labelFill: '#6B21A8', sublabelFill: '#9333EA',
  },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function ForkliftMap({ initialForklifts }: Props) {
  const [forklifts, setForklifts] = useState<Map<number, Forklift>>(
    () => new Map(initialForklifts.map((f) => [f.id, f]))
  );
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  useEffect(() => {
    api.forklifts.list()
      .then((data) => setForklifts(new Map(data.map((f) => [f.id, f]))))
      .catch(() => {});
  }, []);

  const onMessage = useCallback((msg: WsMessage) => {
    if (msg.type !== 'forklift_update') return;
    setForklifts((prev) => {
      const next = new Map(prev);
      next.set(msg.payload.id, {
        ...(prev.get(msg.payload.id) ?? {}),
        ...msg.payload,
        last_updated: new Date().toISOString(),
      } as Forklift);
      return next;
    });
  }, []);

  const { connected } = useWebSocket({ onMessage });

  const items   = Array.from(forklifts.values());
  const hovered = hoveredId != null ? forklifts.get(hoveredId) : undefined;

  // Tooltip: flip left near right edge; clamp vertically for extended SVG.
  const tx = hovered
    ? hovered.x > 64
      ? Math.max(hovered.x - 34, -16)
      : Math.min(hovered.x + 4, 82)
    : 0;
  const ty = hovered ? Math.max(Math.min(hovered.y - 6, 106), -2) : 0;

  // Fleet Status counts — split moving_empty / moving_loaded separately.
  const counts = (Object.keys(STATUS_COLOR) as Forklift['status'][]).map((s) => ({
    status: s,
    count: items.filter((f) => f.status === s).length,
  }));

  return (
    <div className="space-y-4">
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

      <div className="flex flex-col gap-6 xl:flex-row">
        {/* ── SVG warehouse map ─────────────────────────────────────────── */}
        {/*
          Extended viewBox: "-18 -2 136 122"
            x: -18 to 118  (DOCK panel -16..-2 | main grid 0..100 | SHIP panel 102..116)
            y:  -2 to 120  (main grid 0..100 | STOR panel 102..116)
          Gap of 2 SVG units between main grid and each special zone panel.
        */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <svg
            viewBox="-18 -2 136 122"
            className="w-full"
            style={{ maxHeight: 580, display: 'block' }}
            onMouseLeave={() => setHoveredId(null)}
            aria-label="Warehouse floor map"
          >
            {/* ── A1-D4 shelf zone grid ─────────────────────────────────── */}
            {ZONES.map(({ label, x, y }, i) => (
              <g key={label}>
                <rect
                  x={x} y={y} width={25} height={25}
                  fill={ZONE_FILLS[i % 2]} stroke="#CBD5E1" strokeWidth={0.2}
                />
                <text
                  x={x + 12.5} y={y + 12.5}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={3.2} fill="#CBD5E1" fontWeight="700" letterSpacing="0.06em"
                >
                  {label}
                </text>
              </g>
            ))}

            {/* ── Special zone panels (DOCK / SHIP / STOR) ─────────────── */}
            {SPECIAL_ZONES.map((sz) => {
              const cx = sz.rx + sz.rw / 2;
              const cy = sz.ry + sz.rh / 2;
              return (
                <g key={sz.label}>
                  <rect
                    x={sz.rx} y={sz.ry} width={sz.rw} height={sz.rh}
                    fill={sz.fill} stroke={sz.stroke} strokeWidth={0.5} rx={1.5}
                  />
                  <text
                    x={cx} y={cy - 2.8}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={sz.label === 'STOR' ? 3.0 : 3.4}
                    fontWeight="800" fill={sz.labelFill} letterSpacing="0.05em"
                  >
                    {sz.label}
                  </text>
                  <text
                    x={cx} y={cy + 2.5}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={sz.label === 'STOR' ? 2.0 : 2.2}
                    fill={sz.sublabelFill}
                  >
                    {sz.sublabel}
                  </text>
                </g>
              );
            })}

            {/* ── Forklift markers ─────────────────────────────────────── */}
            {items.map((f) => {
              const isHovered = hoveredId === f.id;
              return (
                <g
                  key={f.id}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredId(f.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {f.status === 'error' && (
                    <circle cx={f.x} cy={f.y} r={5}
                      fill="none" stroke={STATUS_COLOR.error}
                      strokeWidth={0.7} opacity={0.3} />
                  )}
                  {isHovered && (
                    <circle cx={f.x} cy={f.y} r={4}
                      fill="none" stroke={STATUS_COLOR[f.status]}
                      strokeWidth={0.6} opacity={0.5} />
                  )}
                  {/* Main marker */}
                  <circle cx={f.x} cy={f.y} r={2.4}
                    fill={STATUS_COLOR[f.status]} stroke="white" strokeWidth={0.5} />
                  {/* Cargo indicator for moving_loaded — small square above marker */}
                  {f.status === 'moving_loaded' && (
                    <rect
                      x={f.x - 1.2} y={f.y - 4.8}
                      width={2.4} height={2.4}
                      fill="#93C5FD" stroke="white" strokeWidth={0.35} rx={0.4}
                    />
                  )}
                  {/* Short label below marker */}
                  <text
                    x={f.x} y={f.y + 5.2}
                    textAnchor="middle" fontSize={1.9} fill="#374151" fontWeight="500"
                  >
                    {f.name.replace('FL-', '')}
                  </text>
                </g>
              );
            })}

            {/* ── SVG tooltip ──────────────────────────────────────────── */}
            {hovered && (
              <g pointerEvents="none">
                <rect
                  x={tx} y={ty} width={30} height={13} rx={1.5}
                  fill="white" stroke="#CBD5E1" strokeWidth={0.3}
                  filter="drop-shadow(0 1px 3px rgba(0,0,0,0.14))"
                />
                <text x={tx + 2} y={ty + 4} fontSize={2.5} fill="#111827" fontWeight="700">
                  {hovered.name}
                </text>
                <text x={tx + 2} y={ty + 7.8} fontSize={2} fill="#6B7280">
                  {STATUS_LABEL[hovered.status]} · ({hovered.x.toFixed(1)},{' '}
                  {hovered.y.toFixed(1)})
                </text>
                <text x={tx + 2} y={ty + 11.2} fontSize={1.8} fill="#9CA3AF">
                  Updated {new Date(hovered.last_updated).toLocaleTimeString()}
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <div className="flex w-full flex-col gap-4 xl:w-60">
          {/* Fleet Status — shows moving_empty and moving_loaded separately */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Fleet Status
            </h2>
            <div className="space-y-2">
              {counts.map(({ status, count }) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLOR[status] }}
                    />
                    <span className="text-gray-700">{STATUS_LABEL[status]}</span>
                  </span>
                  <span className="font-semibold tabular-nums text-gray-900">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Fleet list */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Forklifts
            </h2>
            <div className="space-y-1">
              {items.map((f) => (
                <button
                  key={f.id}
                  className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    hoveredId === f.id
                      ? 'border-blue-200 bg-blue-50'
                      : 'border-transparent hover:bg-gray-50'
                  }`}
                  onMouseEnter={() => setHoveredId(f.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLOR[f.status] }}
                  />
                  <span className="font-medium text-gray-800">{f.name}</span>
                  <span
                    className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[f.status]}`}
                  >
                    {f.status === 'moving_empty'  ? 'empty'  :
                     f.status === 'moving_loaded' ? 'loaded' :
                     f.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
