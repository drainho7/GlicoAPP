import React, { useMemo, useState } from 'react';
import { linearTrend, UserProfile } from '../../src/analytics/analytics';
import { ageAt, BODY_METRICS, BodyMetricKey, BodyReading, metricDelta } from '../../src/body/body';
import { bmiZone, fatZone, muscleZone, visceralZone, waterZone, weightZone, Zone, ZONE_SCALE, ZONE_SOURCE } from '../../src/body/zones';
import { Chart, Series } from './Chart';
import { addDays, friendlyTime, shortDate } from './format';

const toMs = (t: string) => Date.parse(t + 'Z'); // só posiciona no eixo; sem conversão de fuso
const num = (n: number, d: number) => n.toFixed(d).replace('.', ',');
const brDate = (t: string) => t.slice(0, 10).split('-').reverse().join('/');

type Span = '90' | '180' | '365' | 'all';
const SPANS: [Span, string][] = [['90', '3 meses'], ['180', '6 meses'], ['365', '1 ano'], ['all', 'Tudo']];

export function BodyScreen({
  readings,
  onImport,
  busy,
  onOpenFolder,
  profile = {},
}: {
  readings: BodyReading[];
  onImport: (file: File) => void;
  busy: boolean;
  /** Só no app de Windows: abre Documentos\Glico\Importar. */
  onOpenFolder?: () => void;
  /** Sexo, nascimento, altura e peso inicial digitados em Ajustes. */
  profile?: UserProfile;
}) {
  const [metric, setMetric] = useState<BodyMetricKey>('weightKg');
  const [span, setSpan] = useState<Span>('all');

  const importer = (
    <label className={`filebtn${busy ? ' disabled' : ''}`}>
      {busy ? 'Lendo a planilha…' : '📥 Importar planilha do OKOK'}
      <input
        type="file"
        accept=".xlsx"
        hidden
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onImport(f);
        }}
      />
    </label>
  );

  const last = readings[readings.length - 1];
  const def = BODY_METRICS.find((m) => m.key === metric)!;

  const shown = useMemo(() => {
    if (span === 'all' || !last) return readings;
    const from = addDays(last.time.slice(0, 10), -Number(span));
    return readings.filter((r) => r.time.slice(0, 10) >= from);
  }, [readings, span, last]);

  const points = useMemo(
    () => shown.filter((r) => typeof r[metric] === 'number').map((r) => ({ x: toMs(r.time), y: r[metric] as number })),
    [shown, metric],
  );
  const trend = linearTrend(points);
  const xs = points.map((p) => p.x);
  const series: Series[] = [
    { name: def.label, color: 'var(--fg)', line: true, points },
    ...(trend
      ? [{
          name: 'Tendência',
          color: 'var(--fg)',
          line: true,
          dashed: true,
          noDots: true,
          points: [Math.min(...xs), Math.max(...xs)].map((x) => ({ x, y: Math.round((trend.intercept + trend.slope * x) * 100) / 100 })),
        }]
      : []),
  ];

  if (!last) {
    return (
      <section className="card empty">
        <h2>Bioimpedância</h2>
        <p>Acompanhe peso, gordura, massa muscular, água e gordura visceral da sua balança.</p>
        <ol className="steps">
          <li>No app <b>OKOK</b>, abra o histórico, toque em exportar e escolha <b>Excel</b>.</li>
          <li>Envie o arquivo para este computador (AirDrop, e-mail ou Drive).</li>
          <li>
            <b>Arraste</b> o arquivo <code>.xlsx</code> para esta janela
            {onOpenFolder ? <>, ou largue-o na pasta de importação (ele entra sozinho)</> : <>, ou use o botão abaixo</>}.
          </li>
        </ol>
        <div className="row2 center">
          {importer}
          {onOpenFolder && <button className="chip" onClick={onOpenFolder}>📂 Abrir pasta de importação</button>}
        </div>
        <p className="muted">Os dados ficam só neste computador. Ao importar de novo, nada se duplica.</p>
      </section>
    );
  }

  const prevOf = (key: BodyMetricKey) => metricDelta(readings, key);
  const w = prevOf('weightKg');
  // O perfil digitado em Ajustes manda; sem ele, usa o que o app da balança trouxe na planilha.
  const age = ageAt(profile.birth, last.time) ?? last.age;
  const height = profile.heightCm ?? [...readings].reverse().find((r) => r.heightCm)?.heightCm;
  const sex = profile.sex;
  const zBmi = last.bmi !== undefined ? bmiZone(last.bmi, age) : null;
  const zWeight = weightZone(last.weightKg, height, age);

  /** Zona de cada métrica e a fonte da referência. Sem faixa => cartão neutro. */
  const zoneFor = (key: BodyMetricKey): { z: Zone; source: string } | null => {
    const v = last[key];
    if (typeof v !== 'number') return null;
    const pack = (z: Zone | null, source: string) => (z ? { z, source } : null);
    switch (key) {
      case 'weightKg': return pack(zWeight, ZONE_SOURCE.weight);
      case 'bmi': return pack(zBmi, ZONE_SOURCE.weight);
      case 'fatPct': return sex ? pack(fatZone(v, sex, age), ZONE_SOURCE.fat) : null;
      case 'visceralFat': return pack(visceralZone(v, age), ZONE_SOURCE.visceral);
      case 'waterPct': return sex ? pack(waterZone(v, sex), ZONE_SOURCE.water) : null;
      case 'skeletalMusclePct': return sex ? pack(muscleZone(v, sex, age), ZONE_SOURCE.muscle) : null;
      default: return null;
    }
  };
  const older = age !== undefined && age >= 60;
  const startW = profile.startWeightKg ?? readings[0].weightKg;
  const sinceStart = Math.round((last.weightKg - startW) * 100) / 100;
  const previous = readings.length > 1 ? readings[readings.length - 2] : null;
  const arrow = (d: number | null, dec: number) => (d === null ? '' : d === 0 ? '= igual' : `${d > 0 ? '▲ +' : '▼ '}${num(d, dec)}`.replace('▼ -', '▼ −'));

  return (
    <>
      <section className="hero card">
        <div>
          <div className="muted">Última pesagem</div>
          <div className="big">
            {num(last.weightKg, 2)}
            <small> kg</small>
          </div>
          <div>{friendlyTime(last.time)}</div>
          <div className="muted">
            {zBmi && (
              <>
                IMC {num(last.bmi!, 1)} · <span className={`zchip z-${zBmi.level}`}>{zBmi.arrow} {zBmi.label}</span>
              </>
            )}
            {w?.delta !== null && w?.delta !== undefined && previous && (
              <> · {arrow(w.delta, 2)} kg vs {brDate(previous.time)}</>
            )}
          </div>
          {(profile.startWeightKg !== undefined || readings.length > 1) && (
            <div className="muted">
              {profile.startWeightKg !== undefined ? 'Desde o início' : 'Desde a 1ª pesagem'} ({num(startW, 2)} kg):{' '}
              <b>{sinceStart === 0 ? 'sem mudança' : `${sinceStart > 0 ? '▲ +' : '▼ −'}${num(Math.abs(sinceStart), 2)} kg`}</b>
            </div>
          )}
        </div>
        <div className="row2">
          {importer}
          {onOpenFolder && <button className="chip" onClick={onOpenFolder}>📂 Pasta de importação</button>}
        </div>
      </section>

      <section className="card zscale">
        <div className="muted">Escala de cores · quanto mais quente, mais longe da faixa ideal</div>
        <div className="zchips">
          {ZONE_SCALE.map((z) => (
            <span key={z.level} className={`zchip z-${z.level}`}>{z.level === 'ideal' ? 'Na faixa' : z.label}</span>
          ))}
        </div>
        <p className="muted">
          ▼ abaixo da faixa · ● dentro · ▲ acima. <b>Peso e IMC:</b> OMS / Ministério da Saúde (adultos).{' '}
          <b>Gordura, músculo e visceral:</b> tabelas da Omron. <b>Água:</b> faixas usuais de bioimpedância. Esses três não têm tabela
          oficial brasileira: são referências internacionais, e o nome da fonte aparece em cada cartão.
        </p>
        {older && (
          <p className="muted">Para 60 anos ou mais o Ministério usa outros cortes de IMC; por isso o peso e o IMC ficam sem cor.</p>
        )}
        {!sex && (
          <p className="muted"><b>Para colorir gordura, água e músculo, informe seu sexo em Ajustes → Seu perfil.</b></p>
        )}
      </section>

      <div className="metrics">
        {BODY_METRICS.filter((m) => typeof last[m.key] === 'number').map((m) => {
          const d = prevOf(m.key);
          const zr = zoneFor(m.key);
          const z = zr?.z;
          return (
            <button
              key={m.key}
              className={`card metric${metric === m.key ? ' sel' : ''}${z ? ` zone z-${z.level}` : ''}`}
              onClick={() => setMetric(m.key)}
              aria-pressed={metric === m.key}
            >
              <div className="muted">{m.label}</div>
              <div className="mv">
                {num(last[m.key] as number, m.decimals)}
                <small> {m.unit}</small>
              </div>
              {z && (
                <div className="zline">
                  <span className="zarrow">{z.arrow}</span> {z.label}
                </div>
              )}
              {z?.note && <div className="muted znote">{z.note}</div>}
              {zr && <div className="muted znote">Ref.: {zr.source}</div>}
              {m.key === 'weightKg' && zWeight && height && (
                <div className="muted">Ideal para {height} cm: {num(zWeight.ideal[0], 2)}–{num(zWeight.ideal[1], 2)} kg</div>
              )}
              {d?.delta !== null && d?.delta !== undefined && <div className="muted">{arrow(d.delta, m.decimals)} vs anterior</div>}
            </button>
          );
        })}
      </div>

      <section className="card">
        <div className="section-head">
          <h2>Evolução · {def.label}</h2>
          <div className="chips small">
            {SPANS.map(([k, l]) => (
              <button key={k} className={span === k ? 'chip on' : 'chip'} onClick={() => setSpan(k)}>{l}</button>
            ))}
          </div>
        </div>
        <p className="muted">Toque numa métrica acima para ver a evolução dela.</p>
        <Chart series={series} xLabel={shortDate} fit unit={def.unit} />
      </section>

      <section className="card">
        <h2>Histórico</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Data</th><th>Peso</th><th>Gordura</th><th>Músculo</th><th>Água</th><th>Visceral</th></tr>
            </thead>
            <tbody>
              {[...readings].reverse().map((r) => (
                <tr key={r.key}>
                  <td>{brDate(r.time)} {r.time.slice(11, 16)}</td>
                  <td>{num(r.weightKg, 2)} kg</td>
                  <td>{r.fatPct !== undefined ? `${num(r.fatPct, 1)}%` : '—'}</td>
                  <td>{r.muscleKg !== undefined ? `${num(r.muscleKg, 1)} kg` : r.musclePct !== undefined ? `${num(r.musclePct, 1)}%` : '—'}</td>
                  <td>{r.waterPct !== undefined ? `${num(r.waterPct, 1)}%` : '—'}</td>
                  <td>{r.visceralFat !== undefined ? num(r.visceralFat, 1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
