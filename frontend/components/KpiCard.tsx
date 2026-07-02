import type { CSSProperties } from 'react';

interface KpiCardProps {
  label: string;
  value: number | string;
  unit?: string;
  accent: string;
  sub?: string;
}

export function KpiCard({ label, value, unit, accent, sub }: KpiCardProps) {
  const style: CSSProperties = {
    background: '#1A1D27',
    border: '1px solid #2A2D3E',
    borderTop: `3px solid ${accent}`,
    borderRadius: 12,
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    padding: '20px 24px',
    flex: 1,
    minWidth: 0,
  };

  return (
    <div style={style}>
      <p style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
        color: '#64748B', textTransform: 'uppercase', marginBottom: 12,
      }}>
        {label}
      </p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 40, fontWeight: 700, color: '#F1F5F9',
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 16, fontWeight: 500, color: '#64748B' }}>
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <p style={{ fontSize: 11, color: '#4B5563', marginTop: 10 }}>{sub}</p>
      )}
    </div>
  );
}
