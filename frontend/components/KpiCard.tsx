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
    background: '#1D1A26',
    border: '1px solid #2D293D',
    borderTop: `2px solid ${accent}`,
    borderRadius: 12,
    boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
    padding: '20px 24px',
  };

  return (
    <div style={style}>
      <p style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
        color: '#7B778A', textTransform: 'uppercase', marginBottom: 12,
      }}>
        {label}
      </p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 40, fontWeight: 700, color: accent,
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 16, fontWeight: 500, color: '#7B778A' }}>
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <p style={{ fontSize: 11, color: '#5E5A70', marginTop: 10 }}>{sub}</p>
      )}
    </div>
  );
}
