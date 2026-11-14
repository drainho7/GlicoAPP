import React from 'react';

export interface Series {
  name: string;
  color: string;
  /** x: valor numérico (ms ou índice); y: mg/dL */
  points: { x: number; y: number }[];
  line?: boolean;
  /** Linha tracejada (ex.: tendência). */
  dashed?: boolean;
  /** Não desenha os pontos, só a linha. */
  noDots?: boolean;
}

interface Props {
  series: Series[];
  xLabel: (x: number) => string;
  band?: [number, number];
  height?: number;
}

const W = 900;
const PAD = { l: 44, r: 12, t: 12, b: 28 };

export function Chart({ series, xLabel, band, height = 260 }: Props) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return <p className="muted">Sem dados no período.</p>;
  let x0 = Math.min(...pts.map((p) => p.x));
  let x1 = Math.max(...pts.map((p) => p.x));
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const y0 = Math.min(60, ...pts.map((p) => p.y)) - 5;
  const y1 = Math.max(200, ...pts.map((p) => p.y)) + 5;
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => height - PAD.b - ((y - y0) / (y1 - y0)) * (height - PAD.t - PAD.b);
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round(y0 + ((y1 - y0) * i) / 4));
  const xTicks = Array.from({ length: 6 }, (_, i) => x0 + ((x1 - x0) * i) / 5);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Gráfico de glicemia" style={{ width: '100%', height: 'auto' }}>
      {band && (
        <rect x={PAD.l} width={W - PAD.l - PAD.r} y={sy(band[1])} height={Math.max(0, sy(band[0]) - sy(band[1]))} fill="var(--band)" />
      )}
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
          <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={sx(t)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{xLabel(t)}</text>
      ))}
      {series.map((s) => (
        <g key={s.name}>
          {s.line && s.points.length > 1 && (
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 2 : 1.6}
              strokeDasharray={s.dashed ? '7 5' : undefined}
              strokeOpacity={s.dashed ? 0.9 : 0.55}
              strokeLinejoin="round"
              points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
            />
          )}
          {!s.noDots && s.points.map((p, i) => (
            <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={s.line ? 3 : 3.5} fill={s.color} opacity={s.line ? 1 : 0.8}>
              <title>{`${s.name}: ${p.y} mg/dL — ${xLabel(p.x)}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}
