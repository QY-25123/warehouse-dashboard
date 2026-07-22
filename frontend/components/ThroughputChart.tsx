import type { ThroughputBucket } from '@/lib/types';

const VW = 700;
const VH = 160;
const PL = 46;   // left padding (y-axis labels)
const PR = 14;   // right padding
const PT = 14;   // top padding
const PB = 36;   // bottom padding (x-axis labels)
const CW = VW - PL - PR;   // chart width  = 640
const CH = VH - PT - PB;   // chart height = 110

export function ThroughputChart({ data }: { data: ThroughputBucket[] }) {
  const allZero = data.every((d) => d.count === 0);

  if (data.length === 0 || allZero) {
    return (
      <div style={{ height: VH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#9E9AAA', fontSize: 13 }}>No completions recorded yet — data appears here after the first task completes</p>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const slotW = CW / data.length;
  const barW  = Math.max(slotW - 3, 1);

  // Y-axis: 3 labels at 0, 50%, 100% of max
  const yTicks = [0, Math.round(maxCount / 2), maxCount].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      className="w-full"
      style={{ display: 'block' }}
      aria-label="24-hour task throughput bar chart"
    >
      <defs>
        <linearGradient id="tpc-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#22D3EE" />
          <stop offset="100%" stopColor="#0891B2" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="tpc-bar-hi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#67E8F9" />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.8" />
        </linearGradient>
      </defs>

      {/* Y-axis gridlines + labels */}
      {yTicks.map((v) => {
        const y = PT + CH - (v / maxCount) * CH;
        return (
          <g key={v}>
            <line
              x1={PL} y1={y} x2={PL + CW} y2={y}
              stroke="#2D293D" strokeWidth={v === 0 ? 0.8 : 0.5}
            />
            <text
              x={PL - 6} y={y + 4}
              textAnchor="end" fontSize={10} fill="#7B778A"
            >
              {v}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const x     = PL + i * slotW;
        const barH  = d.count > 0 ? Math.max((d.count / maxCount) * CH, 2) : 0;
        const y     = PT + CH - barH;
        const isMax = d.count === maxCount && d.count > 0;
        const hour  = new Date(d.bucket).getHours();
        const label = `${hour.toString().padStart(2, '0')}:00 — ${d.count} task${d.count !== 1 ? 's' : ''}`;

        return (
          <g key={d.bucket}>
            {/* Transparent full-height hit target for tooltip */}
            <rect x={x + 1.5} y={PT} width={barW} height={CH} fill="transparent">
              <title>{label}</title>
            </rect>
            {d.count > 0 && (
              <rect
                x={x + 1.5} y={y}
                width={barW} height={barH}
                fill={`url(#${isMax ? 'tpc-bar-hi' : 'tpc-bar'})`}
                rx={2}
              />
            )}
          </g>
        );
      })}

      {/* X-axis labels every 6 hours */}
      {data.map((d, i) => {
        if (i % 6 !== 0) return null;
        const x    = PL + (i + 0.5) * slotW;
        const hour = new Date(d.bucket).getHours();
        return (
          <text key={d.bucket} x={x} y={VH - 8}
            textAnchor="middle" fontSize={10} fill="#7B778A">
            {`${hour.toString().padStart(2, '0')}:00`}
          </text>
        );
      })}

      {/* "now" label at far right */}
      <text x={PL + CW} y={VH - 8} textAnchor="end" fontSize={10} fill="#5E5A70">
        now
      </text>
    </svg>
  );
}
