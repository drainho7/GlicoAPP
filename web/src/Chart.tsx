import React from 'react';
import { Settings } from '../../src/analytics/analytics';

export interface ChartPoint {
  x: number;
  y: number;
  /** Situação em relação à meta da categoria da leitura: ganha um anel quando 'high' (laranja) ou 'low' (vermelho). */
  status?: 'ok' | 'high' | 'low';
}

export interface RefLine {
  y: number;
  label: string;
}

/** Linhas de meta (limite superior) para o gráfico geral: jejum e pós-refeição. Une as que caem no mesmo valor. */
export function targetRefLines(s: Settings): RefLine[] {
  const groups = new Map<number, string[]>();
  const add = (y: number, name: string) => groups.set(y, [...(groups.get(y) ?? []), name]);
  add(s.targets.jejum[1], 'jejum');
  if (s.targets.almoco[1] === s.targets.janta[1]) add(s.targets.almoco[1], 'pós-refeição');
  else {
    add(s.targets.almoco[1], 'almoço');
    add(s.targets.janta[1], 'janta');
  }
  return [...groups].map(([y, names]) => ({ y, label: `meta ${names.join(' e ')} ${y}` }));
}

export interface Series {
  name: string;
  color: string;
  /** x: valor numérico (ms ou índice); y: mg/dL */
  points: ChartPoint[];
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
  refLines?: RefLine[];
  height?: number;
  /** Ajusta o eixo vertical aos dados (para métricas que não são glicemia). */
  fit?: boolean;
  /** Unidade mostrada na dica de cada ponto. */
  unit?: string;
}

const W = 900;
const PAD = { l: 44, r: 12, t: 12, b: 28 };

export function Chart({ series, xLabel, band, refLines = [], height = 260, fit = false, unit = 'mg/dL' }: Props) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return <p className="muted">Sem dados no período.</p>;
  let x0 = Math.min(...pts.map((p) => p.x));
  let x1 = Math.max(...pts.map((p) => p.x));
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const ys = [...pts.map((p) => p.y), ...refLines.map((r) => r.y)];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = Math.max((hi - lo) * 0.15, hi === lo ? Math.max(hi * 0.02, 1) : 0);
  const y0 = fit ? lo - pad : Math.min(60, ...ys) - 5;
  const y1 = fit ? hi + pad : Math.max(200, ...ys) + 5;
  const tickDecimals = y1 - y0 < 8 ? 1 : 0;
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => height - PAD.b - ((y - y0) / (y1 - y0)) * (height - PAD.t - PAD.b);
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = y0 + ((y1 - y0) * i) / 4;
    return fit ? Number(v.toFixed(tickDecimals)) : Math.round(v);
  });
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
      {refLines.map((r) => (
        <g key={r.y}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(r.y)} y2={sy(r.y)} stroke="var(--high)" strokeOpacity="0.6" strokeDasharray="3 5" />
          <text x={W - PAD.r - 2} y={sy(r.y) - 4} textAnchor="end" fontSize="10.5" fill="var(--high)">{r.label}</text>
        </g>
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
          {s.points.map((p, i) =>
            p.status === 'high' || p.status === 'low' ? (
              <circle
                key={`ring${i}`}
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={8}
                fill={p.status === 'high' ? 'var(--high)' : 'var(--low)'}
                fillOpacity="0.18"
                stroke={p.status === 'high' ? 'var(--high)' : 'var(--low)'}
                strokeWidth="2"
              />
            ) : null,
          )}
          {!s.noDots && s.points.map((p, i) => (
            <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={s.line ? 3 : 3.5} fill={s.color} opacity={s.line ? 1 : 0.8}>
              <title>{`${s.name}: ${p.y} ${unit} — ${xLabel(p.x)}${p.status === 'high' ? ' · acima da meta' : p.status === 'low' ? ' · abaixo da meta' : ''}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}
