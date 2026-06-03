'use client';

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import type { Forklift, Task, WsMessage } from '@/lib/types';
import { api } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Props {
  initialForklifts: Forklift[];
  onFleetChange?: (forklifts: Forklift[]) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<Forklift['status'], string> = {
  idle:          '#374151',
  moving_empty:  '#93C5FD',
  moving_loaded: '#1D4ED8',
  loading:       '#10B981',
  error:         '#EF4444',
};

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

const TASK_TYPE_STYLE: Record<Task['type'], { bg: string; border: string; color: string; label: string }> = {
  inbound:       { bg: '#8B5CF620', border: '#8B5CF650', color: '#A78BFA', label: 'Inbound'       },
  outbound:      { bg: '#F9731620', border: '#F9731650', color: '#FB923C', label: 'Outbound'      },
  relocation:    { bg: '#3B82F620', border: '#3B82F650', color: '#60A5FA', label: 'Relocation'    },
  replenishment: { bg: '#10B98120', border: '#10B98150', color: '#10B981', label: 'Replenishment' },
};

// 11 rows A-K, 4 cols; each row = 10 SVG units, each col = 25 SVG units.
const ZONES = (['A','B','C','D','E','F','G','H','I','J','K'] as const).flatMap((row, ri) =>
  ([1, 2, 3, 4] as const).map((col) => ({
    label: `${row}${col}`,
    x: (col - 1) * 25,
    y: ri * 10,
  }))
);

function coordsToZone(x: number, y: number): string {
  if (x < 0)    return 'DOCK';
  if (x > 100)  return 'SHIP';
  if (y > 110)  return 'STOR';
  const col = Math.min(Math.floor(x / 25), 3) + 1;
  const row = String.fromCharCode(65 + Math.min(Math.floor(y / 10), 10));
  return `${row}${col}`;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

function phaseLabel(fstatus: Forklift['status'] | undefined, phase: string | undefined): string {
  if (phase === 'pickup_moving')    return '→ Travelling to pickup';
  if (phase === 'pickup_loading')   return '↓ Picking up cargo';
  if (phase === 'delivery_moving')  return '→ Travelling to destination';
  if (phase === 'delivery_loading') return '↓ Delivering cargo';
  if (fstatus === 'moving_empty')   return '→ Travelling to pickup';
  if (fstatus === 'loading')        return '↓ Loading';
  if (fstatus === 'moving_loaded')  return '→ Travelling to destination';
  return 'In progress';
}

// ── SVG Warehouse Floor ───────────────────────────────────────────────────────

function WarehouseFloor() {
  return (
    <>
      {/* Outer shell */}
      <rect x={-1} y={-1} width={102} height={112} rx={2}
        fill="#141720" stroke="#2A2D3E" strokeWidth={0.4} />

      {/* Zone cells with shelf texture */}
      {ZONES.map(({ label, x, y }) => (
        <g key={label}>
          <rect x={x+0.2} y={y+0.2} width={24.6} height={9.6}
            fill="#1A1D27" stroke="#252838" strokeWidth={0.2} />
          <line x1={x+1} y1={y+5} x2={x+24} y2={y+5}
            stroke="#1E2632" strokeWidth={0.3} />
          <text x={x+2} y={y+3.8} fontSize={2.2} fill="#6B7280"
            fontWeight="500" letterSpacing="0.08em">
            {label}
          </text>
        </g>
      ))}

      {/* Aisle grid lines */}
      {[25, 50, 75].map((v) => (
        <line key={`v${v}`} x1={v} y1={0} x2={v} y2={110} stroke="#1E2130" strokeWidth={0.4} />
      ))}
      {[10,20,30,40,50,60,70,80,90,100].map((v) => (
        <line key={`h${v}`} x1={0} y1={v} x2={100} y2={v} stroke="#1E2130" strokeWidth={0.4} />
      ))}

      {/* Directional chevrons — horizontal → */}
      {[5,15,25,35,45,55,65,75,85,95,105].map((cy) =>
        [10,35,60,85].map((cx) => (
          <path key={`h${cx}${cy}`}
            d={`M${cx},${cy-0.5} L${cx+1},${cy} L${cx},${cy+0.5}`}
            fill="none" stroke="#2A3550" strokeWidth={0.35} />
        ))
      )}
      {/* Directional chevrons — vertical ↓ */}
      {[12.5,37.5,62.5,87.5].map((cx) =>
        [5,15,25,35,45,55,65,75,85,95,105].map((cy) => (
          <path key={`v${cx}${cy}`}
            d={`M${cx-0.5},${cy} L${cx},${cy+1} L${cx+0.5},${cy}`}
            fill="none" stroke="#2A3550" strokeWidth={0.35} />
        ))
      )}

      {/* DOCK — left, centered at y=55 */}
      <g>
        <rect x={-16} y={40} width={14} height={30} rx={1.5}
          fill="rgba(59,130,246,0.08)" stroke="#3B82F6" strokeWidth={0.5} strokeDasharray="2 1.5" />
        {[-4,0,4].map((dy) => (
          <line key={dy} x1={-16} y1={55+dy} x2={-14} y2={55+dy}
            stroke="#3B82F6" strokeWidth={0.6} opacity={0.5} />
        ))}
        <path d="M-4.5,54.3 L-2.5,55 L-4.5,55.7" fill="none" stroke="#3B82F6" strokeWidth={0.7} />
        <text x={-9} y={53.2} textAnchor="middle" fontSize={2.8} fill="#3B82F6" fontWeight="800" letterSpacing="0.05em">DOCK</text>
        <text x={-9} y={57.5} textAnchor="middle" fontSize={1.8} fill="#93C5FD">RECEIVING</text>
      </g>

      {/* SHIP — right, centered at y=55 */}
      <g>
        <rect x={102} y={40} width={14} height={30} rx={1.5}
          fill="rgba(249,115,22,0.08)" stroke="#F97316" strokeWidth={0.5} strokeDasharray="2 1.5" />
        {[-4,0,4].map((dy) => (
          <line key={dy} x1={114} y1={55+dy} x2={116} y2={55+dy}
            stroke="#F97316" strokeWidth={0.6} opacity={0.5} />
        ))}
        <path d="M104.5,54.3 L106.5,55 L104.5,55.7" fill="none" stroke="#F97316" strokeWidth={0.7} />
        <text x={109} y={53.2} textAnchor="middle" fontSize={2.8} fill="#F97316" fontWeight="800" letterSpacing="0.05em">SHIP</text>
        <text x={109} y={57.5} textAnchor="middle" fontSize={1.8} fill="#FB923C">SHIPPING</text>
      </g>

      {/* STOR — bottom, centered at x=50 */}
      <g>
        <rect x={37.5} y={112} width={25} height={8} rx={1.5}
          fill="rgba(139,92,246,0.08)" stroke="#8B5CF6" strokeWidth={0.5} strokeDasharray="2 1.5" />
        {[-5,0,5].map((dx) => (
          <rect key={dx} x={50+dx-1.2} y={113.5} width={2.4} height={1.8} rx={0.3}
            fill="none" stroke="#8B5CF680" strokeWidth={0.35} />
        ))}
        <text x={50} y={114.5} textAnchor="middle" fontSize={2.5} fill="#8B5CF6" fontWeight="800" letterSpacing="0.05em">STOR</text>
        <text x={50} y={117.8} textAnchor="middle" fontSize={1.7} fill="#A78BFA">STORAGE</text>
      </g>
    </>
  );
}

// ── Forklift Marker ───────────────────────────────────────────────────────────

function ForkliftMarker({
  f, prevPos, isHovered, onEnter, onLeave,
}: {
  f: Forklift;
  prevPos: { x: number; y: number } | undefined;
  isHovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const color = STATUS_COLOR[f.status];
  const dx    = prevPos ? f.x - prevPos.x : 0;
  const dy    = prevPos ? f.y - prevPos.y : 0;
  const angle = (Math.abs(dx) + Math.abs(dy) > 0.1)
    ? (Math.atan2(dy, dx) * 180) / Math.PI + 90
    : 0;
  const num = f.name.replace('FL-', '');

  return (
    <g style={{ cursor: 'pointer', transition: 'transform 1.8s ease' }}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {f.status === 'error' && (
        <>
          <circle cx={f.x} cy={f.y} r={4} fill="none" stroke="#EF4444"
            strokeWidth={0.5} opacity={0.25} className="animate-ping" />
          <circle cx={f.x} cy={f.y} r={3.2} fill="none" stroke="#EF4444"
            strokeWidth={0.4} opacity={0.4} />
        </>
      )}
      {f.status === 'loading' && (
        <circle cx={f.x} cy={f.y} r={3} fill="#10B98115" stroke="#10B981"
          strokeWidth={0.35} opacity={0.6} />
      )}
      {isHovered && (
        <circle cx={f.x} cy={f.y} r={3.8} fill="none" stroke={color}
          strokeWidth={0.4} opacity={0.6} />
      )}
      <g transform={`rotate(${angle}, ${f.x}, ${f.y})`}>
        <rect x={f.x-1.6} y={f.y-2.4} width={3.2} height={4.8} rx={0.7}
          fill={color} stroke="rgba(255,255,255,0.2)" strokeWidth={0.25} />
        <line x1={f.x-0.9} y1={f.y-2.4} x2={f.x-0.9} y2={f.y-3.8}
          stroke={color} strokeWidth={0.6} />
        <line x1={f.x+0.9} y1={f.y-2.4} x2={f.x+0.9} y2={f.y-3.8}
          stroke={color} strokeWidth={0.6} />
        {f.status === 'moving_loaded' && (
          <rect x={f.x-1.1} y={f.y-4.4} width={2.2} height={1.8} rx={0.3}
            fill="#F97316" stroke="rgba(255,255,255,0.3)" strokeWidth={0.25} />
        )}
      </g>
      <rect x={f.x-2.4} y={f.y+2.8} width={4.8} height={2.2} rx={1.1}
        fill="rgba(15,17,23,0.8)" />
      <text x={f.x} y={f.y+4.3} textAnchor="middle" fontSize={1.7}
        fill={LABEL_COLOR[f.status]} fontWeight="600">
        {num}
      </text>
    </g>
  );
}

// ── SVG Tooltip ───────────────────────────────────────────────────────────────

function MapTooltip({ f, tx, ty }: { f: Forklift; tx: number; ty: number }) {
  const zone = coordsToZone(f.x, f.y);
  return (
    <g pointerEvents="none">
      <rect x={tx} y={ty} width={34} height={16} rx={2}
        fill="#1A1D27" stroke="#2A2D3E" strokeWidth={0.4}
        filter="drop-shadow(0 2px 8px rgba(0,0,0,0.6))" />
      <text x={tx+2.5} y={ty+4.5} fontSize={2.8} fill="#F1F5F9" fontWeight="700">{f.name}</text>
      <text x={tx+2.5} y={ty+8.2} fontSize={2.1} fill="#94A3B8">{STATUS_LABEL[f.status]}</text>
      <text x={tx+2.5} y={ty+11.5} fontSize={2.1} fill="#94A3B8">Zone: {zone}</text>
      <text x={tx+2.5} y={ty+14.8} fontSize={1.8} fill="#64748B">
        {f.x.toFixed(1)}, {f.y.toFixed(1)}
      </text>
    </g>
  );
}

// ── Donut Chart ───────────────────────────────────────────────────────────────

function DonutChart({ counts, total }: { counts: { status: Forklift['status']; count: number }[]; total: number }) {
  const R = 28; const C = 2 * Math.PI * R;
  let offset = 0;
  const slices = counts.filter((c) => c.count > 0).map((c) => {
    const dash  = (c.count / Math.max(total, 1)) * C;
    const slice = { status: c.status, dash, gap: C - dash, offset };
    offset += dash;
    return slice;
  });
  return (
    <svg width={80} height={80} viewBox="0 0 80 80">
      <circle cx={40} cy={40} r={R} fill="none" stroke="#1E2130" strokeWidth={10} />
      {slices.map((s) => (
        <circle key={s.status} cx={40} cy={40} r={R} fill="none"
          stroke={STATUS_COLOR[s.status]} strokeWidth={10}
          strokeDasharray={`${s.dash} ${s.gap}`}
          strokeDashoffset={C/4 - s.offset}
          style={{ transition: 'stroke-dasharray 0.4s ease' }} />
      ))}
      <text x={40} y={37} textAnchor="middle" fontSize={11} fill="#F1F5F9" fontWeight="700">{total}</text>
      <text x={40} y={49} textAnchor="middle" fontSize={7} fill="#94A3B8">units</text>
    </svg>
  );
}

// ── Active Tasks Panel ────────────────────────────────────────────────────────

function ActiveTasksPanel({
  tasks, forklifts, forkliftPhases, hoveredId, onHover,
}: {
  tasks: Task[];
  forklifts: Map<number, Forklift>;
  forkliftPhases: Map<number, string>;
  hoveredId: number | null;
  onHover: (fid: number | null) => void;
}) {
  const panelStyle: CSSProperties = {
    background: '#1A1D27',
    border: '1px solid #2A2D3E',
    borderRadius: 12,
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    minHeight: 0,
    flex: 1,
    overflowY: 'auto',
  };

  return (
    <div style={panelStyle}>
      {/* Title */}
      <div className="flex items-center justify-between mb-3" style={{ flexShrink: 0 }}>
        <h2 style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: '#94A3B8' }}>
          ACTIVE TASKS
        </h2>
        <span style={{
          fontSize: 10, fontWeight: 700, color: '#3B82F6',
          background: '#3B82F620', border: '1px solid #3B82F640',
          borderRadius: 999, padding: '1px 7px',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {tasks.length}
        </span>
      </div>

      {tasks.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 12, color: '#4B5563', textAlign: 'center' }}>No active tasks</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
          {tasks.map((task) => {
            const fork     = task.forklift_id != null ? forklifts.get(task.forklift_id) : undefined;
            const phase    = fork ? forkliftPhases.get(fork.id) : undefined;
            const typeStyle = TASK_TYPE_STYLE[task.type];
            const isHighlighted = task.forklift_id != null && hoveredId === task.forklift_id;

            return (
              <div
                key={task.id}
                onMouseEnter={() => task.forklift_id != null && onHover(task.forklift_id)}
                onMouseLeave={() => onHover(null)}
                style={{
                  background: isHighlighted ? '#2A2D3E' : '#0F111780',
                  border: `1px solid ${isHighlighted ? typeStyle.color + '60' : '#2A2D3E'}`,
                  borderLeft: `3px solid ${typeStyle.color}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  cursor: 'default',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                {/* Header row */}
                <div className="flex items-center justify-between mb-1.5">
                  <span style={{ fontSize: 10, color: '#4B5563', fontVariantNumeric: 'tabular-nums' }}>
                    #{task.id}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, color: typeStyle.color,
                    background: typeStyle.bg, border: `1px solid ${typeStyle.border}`,
                    borderRadius: 999, padding: '1px 6px',
                  }}>
                    {typeStyle.label}
                  </span>
                </div>

                {/* Route */}
                <div style={{ fontSize: 12, fontWeight: 600, color: '#F1F5F9', marginBottom: 4 }}>
                  {task.origin_zone ?? '?'} → {task.destination_zone ?? '?'}
                </div>

                {/* Forklift */}
                {fork && (
                  <div className="flex items-center gap-1.5 mb-3">
                    <span style={{ fontSize: 10, color: '#94A3B8' }}>🚜</span>
                    <span style={{ fontSize: 11, color: '#94A3B8' }}>{fork.name}</span>
                    <span style={{
                      marginLeft: 'auto',
                      fontSize: 9, fontWeight: 600,
                      color: STATUS_BADGE_STYLE[fork.status].color,
                      background: STATUS_BADGE_STYLE[fork.status].bg,
                      border: `1px solid ${STATUS_BADGE_STYLE[fork.status].border}`,
                      borderRadius: 999, padding: '1px 5px',
                    }}>
                      {STATUS_BADGE_STYLE[fork.status].text}
                    </span>
                  </div>
                )}

                {/* Phase indicator */}
                <div style={{
                  fontSize: 10, color: typeStyle.color,
                  background: typeStyle.bg, borderRadius: 4,
                  padding: '2px 6px', marginBottom: 4,
                }}>
                  {phaseLabel(fork?.status, phase)}
                </div>

                {/* Time */}
                <div style={{ fontSize: 10, color: '#4B5563' }}>
                  {timeAgo(task.updated_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ForkliftMap({ initialForklifts, onFleetChange }: Props) {
  const [forklifts, setForklifts] = useState<Map<number, Forklift>>(
    () => new Map(initialForklifts.map((f) => [f.id, f]))
  );
  const [hoveredId, setHoveredId]       = useState<number | null>(null);
  const [activeTasks, setActiveTasks]   = useState<Map<number, Task>>(new Map());
  const [forkliftPhases, setForkliftPhases] = useState<Map<number, string>>(new Map());

  const prevPositions  = useRef<Map<number, { x: number; y: number }>>(new Map());
  const prevStatusRef  = useRef<Map<number, string>>(new Map());

  // Initial REST fetches
  useEffect(() => {
    api.forklifts.list()
      .then((data) => setForklifts(new Map(data.map((f) => [f.id, f]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.tasks.list({ status: 'in-progress' })
      .then((tasks) => setActiveTasks(new Map(tasks.map((t) => [t.id, t]))))
      .catch(() => {});
  }, []);

  // Notify parent of fleet changes
  useEffect(() => {
    onFleetChange?.(Array.from(forklifts.values()));
  }, [forklifts, onFleetChange]);

  const onMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'forklift_update') {
      const { id, status } = msg.payload;
      const prevStatus = prevStatusRef.current.get(id) ?? '';

      setForkliftPhases((prev) => {
        const next = new Map(prev);
        if (status === 'loading') {
          if (prevStatus === 'moving_empty')  next.set(id, 'pickup_loading');
          else if (prevStatus === 'moving_loaded') next.set(id, 'delivery_loading');
        } else if (status === 'moving_empty')  { next.set(id, 'pickup_moving');  }
        else if (status === 'moving_loaded')   { next.set(id, 'delivery_moving'); }
        else if (status === 'idle')            { next.delete(id); }
        return next;
      });
      prevStatusRef.current.set(id, status);

      setForklifts((prev) => {
        const existing = prev.get(id);
        if (existing) prevPositions.current.set(id, { x: existing.x, y: existing.y });
        const next = new Map(prev);
        next.set(id, { ...(existing ?? {}), ...msg.payload, last_updated: new Date().toISOString() } as Forklift);
        return next;
      });
    }

    if (msg.type === 'task_update') {
      const { id, status } = msg.payload;
      if (status === 'in-progress') {
        setActiveTasks((prev) => {
          const existing = prev.get(id);
          const next = new Map(prev);
          next.set(id, {
            ...(existing ?? {
              id, type: msg.payload.type,
              inventory_item_id: null, item_name: null,
              created_at: new Date().toISOString(),
            }),
            ...msg.payload,
            updated_at: new Date().toISOString(),
          } as Task);
          return next;
        });
      } else {
        setActiveTasks((prev) => { const next = new Map(prev); next.delete(id); return next; });
      }
    }
  }, []);

  const { connected } = useWebSocket({ onMessage });

  const items  = Array.from(forklifts.values());
  const sorted = [...items].sort((a, b) => {
    if (a.status === 'error' && b.status !== 'error') return -1;
    if (b.status === 'error' && a.status !== 'error') return  1;
    return a.id - b.id;
  });

  const activeTasksList = Array.from(activeTasks.values())
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const hovered = hoveredId != null ? forklifts.get(hoveredId) : undefined;
  const tx = hovered ? (hovered.x > 64 ? Math.max(hovered.x - 36, -16) : Math.min(hovered.x + 4, 80)) : 0;
  const ty = hovered ? Math.max(Math.min(hovered.y - 8, 116), -2) : 0;

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

      {/* Three-panel layout */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>

        {/* Left panel — Active Tasks */}
        <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', alignSelf: 'stretch' }}>
          <ActiveTasksPanel
            tasks={activeTasksList}
            forklifts={forklifts}
            forkliftPhases={forkliftPhases}
            hoveredId={hoveredId}
            onHover={setHoveredId}
          />
        </div>

        {/* Center — SVG map */}
        <div className="min-w-0 flex-1 overflow-hidden" style={{ ...panelStyle }}>
          <svg
            viewBox="-18 -2 136 128"
            className="w-full"
            style={{ display: 'block' }}
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

            {hovered && <MapTooltip f={hovered} tx={tx} ty={ty} />}
          </svg>
        </div>

        {/* Right panel */}
        <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Fleet Status */}
          <div style={{ ...panelStyle, padding: 16 }}>
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
                        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: col }} />
                        <span style={{ fontSize: 12, color: '#94A3B8' }}>{STATUS_LABEL[status]}</span>
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#F1F5F9', fontVariantNumeric: 'tabular-nums' }}>
                        {count}
                      </span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: '#0F1117', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`, backgroundColor: col,
                        borderRadius: 2, transition: 'width 0.4s ease', opacity: count === 0 ? 0.2 : 1,
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fleet Roster */}
          <div style={{ ...panelStyle, padding: 16, overflow: 'hidden' }}>
            <h2 style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: '#94A3B8', marginBottom: 12 }}>
              FLEET ROSTER
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sorted.map((f, i) => {
                const badge = STATUS_BADGE_STYLE[f.status];
                const isErr = f.status === 'error';
                const isHov = hoveredId === f.id;
                const zone  = coordsToZone(f.x, f.y);
                return (
                  <button
                    key={f.id}
                    onMouseEnter={() => setHoveredId(f.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                      textAlign: 'left', transition: 'background 0.15s', width: '100%',
                      border: isErr ? '1px solid #EF444440' : '1px solid transparent',
                      borderTop: isErr ? '2px solid #EF4444' : undefined,
                      background: isHov ? '#2A2D3E' : i % 2 === 0 ? '#0F111780' : 'transparent',
                    }}
                  >
                    <span className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: STATUS_COLOR[f.status] }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#F1F5F9', flex: 1 }}>
                      {f.name}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 500, color: '#94A3B8',
                      background: '#0F1117', border: '1px solid #2A2D3E',
                      borderRadius: 4, padding: '1px 5px',
                    }}>
                      {zone}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: badge.color,
                      background: badge.bg, border: `1px solid ${badge.border}`,
                      borderRadius: 999, padding: '1px 7px',
                      display: 'flex', alignItems: 'center', gap: 3,
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
