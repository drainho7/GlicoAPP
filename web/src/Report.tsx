import React, { useEffect, useMemo } from 'react';
import {
  calibrateWithExam,
  CATEGORY_LABEL,
  classify,
  estimateA1c,
  filterRange,
  groupByPeriod,
  Period,
  previousRange,
  statusOf,
  summarizeByCategory,
  Status,
} from '../../src/analytics/analytics';
import { Chart, Series } from './Chart';
import { groupLabel, shortDate } from './format';
import './report.css';
import { loadReadings, loadSettings } from './store';

export const isReportRoute = () => location.hash.startsWith('#/relatorio');

const COLOR = { jejum: '#1e88e5', almoco: '#f9a825', janta: '#8e24aa', outra: '#78909c' } as const;
const STATUS_TEXT: Record<Status, string> = { ok: 'na meta', high: 'acima', low: 'abaixo' };
const toMs = (t: string) => Date.parse(t + 'Z');
const br = (d: string) => d.split('-').reverse().join('/');
const fmt = (n: number | null) => (n === null ? '—' : String(Math.round(n)));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000) + 1;

function readParams() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  return { from: q.get('from') || undefined, to: q.get('to') || undefined };
}

export default function Report() {
  const { from, to } = readParams();
  const all = useMemo(() => loadReadings(), []);
  const settings = useMemo(() => loadSettings(), []);
  const rs = useMemo(() => filterRange(all, from, to), [all, from, to]);

  const sum = useMemo(() => summarizeByCategory(rs, settings), [rs, settings]);
  const first = rs[0]?.time.slice(0, 10);
  const last = rs[rs.length - 1]?.time.slice(0, 10);
  const rFrom = from ?? first ?? '';
  const rTo = to ?? last ?? '';

  const prev = useMemo(() => {
    if (!from || !to) return null;
    const p = previousRange(from, to);
    return summarizeByCategory(filterRange(all, p.from, p.to), settings);
  }, [all, from, to, settings]);

  // HbA1c estimada: 90 dias terminando no fim do período do relatório (simulação, não é exame).
  const est = useMemo(() => (rTo ? estimateA1c(all, rTo) : null), [all, rTo]);
  const cal = useMemo(() => (settings.exam ? calibrateWithExam(all, settings.exam) : null), [all, settings.exam]);
  const pc = (n: number) => n.toFixed(1).replace('.', ',');

  const span = rFrom && rTo ? daysBetween(rFrom, rTo) : 0;
  const period: Period = span <= 45 ? 'day' : span <= 200 ? 'week' : 'month';
  const groups = useMemo(() => groupByPeriod(rs, period, settings), [rs, period, settings]);

  const inTarget = useMemo(() => {
    if (!rs.length) return null;
    const ok = rs.filter((r) => statusOf(r.mgdl, classify(r.time, settings), settings) === 'ok').length;
    return Math.round((ok / rs.length) * 100);
  }, [rs, settings]);

  const series: Series[] = (['jejum', 'almoco', 'janta', 'outra'] as const).map((c) => ({
    name: CATEGORY_LABEL[c],
    color: COLOR[c],
    points: rs.filter((r) => classify(r.time, settings) === c).map((r) => ({ x: toMs(r.time), y: r.mgdl })),
  }));

  useEffect(() => {
    document.title = 'Relatório de glicemia';
    document.body.style.background = '#fff';
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        (window as unknown as { __reportReady?: boolean }).__reportReady = true;
        window.dispatchEvent(new Event('report-ready'));
        if (!window.glico) setTimeout(() => window.print(), 400); // no navegador: abre o diálogo de impressão
      }),
    );
  }, []);

  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const cats = ['jejum', 'almoco', 'janta'] as const;
  const byDay = new Map<string, typeof rs>();
  for (const r of rs) (byDay.get(r.time.slice(0, 10)) ?? byDay.set(r.time.slice(0, 10), []).get(r.time.slice(0, 10))!).push(r);

  return (
    <div className="report">
      <header className="r-head">
        <div>
          <div className="r-brand">GLICO</div>
          <h1>Relatório de glicemia</h1>
          <div className="r-sub">
            {rFrom ? `${br(rFrom)} a ${br(rTo)}` : 'Sem leituras'} · {rs.length} {rs.length === 1 ? 'medição' : 'medições'}
          </div>
        </div>
        <div className="r-stamp">Gerado em<br />{stamp}</div>
      </header>
      <div className="r-stripe" />

      {rs.length === 0 ? (
        <p className="r-empty">Nenhuma leitura neste período.</p>
      ) : (
        <>
          <section className="r-kpis">
            <div className="kpi"><span>Média geral</span><b>{fmt(sum.all.mean)}</b><small>mg/dL</small></div>
            <div className="kpi"><span>Mínima</span><b>{fmt(sum.all.min)}</b><small>mg/dL</small></div>
            <div className="kpi"><span>Máxima</span><b>{fmt(sum.all.max)}</b><small>mg/dL</small></div>
            <div className="kpi accent"><span>Dentro da meta</span><b>{inTarget ?? '—'}%</b><small>das medições</small></div>
          </section>

          {est && (
            <section className="r-a1c">
              <div className="a1c-main">
                <span>HbA1c estimada <em>simulação · não é exame</em></span>
                <b>{pc(est.a1c)}<small> %</small></b>
                <small>média {Math.round(est.mean)} mg/dL · {est.count} leituras em {est.days} dias (até {br(est.windowTo)}) · cobertura {est.confidence}</small>
              </div>
              {settings.exam && (
                <div className="a1c-ex">
                  <span>Último exame informado</span>
                  <b>{pc(settings.exam.value)}<small> % · {br(settings.exam.date)}</small></b>
                  {cal && (
                    <small>
                      Na época a estimativa dava {pc(cal.atExam.a1c)}% (diferença {cal.delta > 0 ? '+' : ''}{pc(cal.delta)}); ajustada: {pc(Math.max(3, Math.round((est.a1c + cal.delta) * 10) / 10))}%
                    </small>
                  )}
                </div>
              )}
              <p>Referência apenas: a HbA1c real vem do exame de laboratório. A estimativa usa a média das glicemias e tende a errar com poucas medições por dia.</p>
            </section>
          )}

          <h2>Por momento do dia</h2>
          <section className="r-cats">
            {cats.map((c) => {
              const s = sum.byCategory[c];
              const pm = prev?.byCategory[c].mean ?? null;
              const delta = s.mean !== null && pm !== null ? Math.round(s.mean - pm) : null;
              const [lo, hi] = settings.targets[c];
              return (
                <div className="catc" key={c} style={{ borderTopColor: COLOR[c] }}>
                  <div className="cn"><i style={{ background: COLOR[c] }} /> {CATEGORY_LABEL[c]}</div>
                  <div className="cv">{fmt(s.mean)}<small> mg/dL</small></div>
                  <div className="cm">média de {s.count} leitura{s.count === 1 ? '' : 's'}</div>
                  <div className="cm">mín {fmt(s.min)} · máx {fmt(s.max)}</div>
                  {s.inRangePct !== null && (
                    <>
                      <div className="bar"><div style={{ width: `${s.inRangePct}%`, background: COLOR[c] }} /></div>
                      <div className="cm">{Math.round(s.inRangePct)}% na meta ({lo}–{hi})</div>
                    </>
                  )}
                  {delta !== null && <div className="cm">{delta === 0 ? 'igual' : delta > 0 ? `▲ +${delta}` : `▼ ${delta}`} vs período anterior</div>}
                </div>
              );
            })}
          </section>

          <h2>Evolução no período</h2>
          <section className="r-chart">
            <div className="legend">
              {series.filter((s) => s.points.length).map((s) => (
                <span key={s.name}><i style={{ background: s.color }} /> {s.name}</span>
              ))}
            </div>
            <Chart series={series} xLabel={shortDate} height={230} />
          </section>

          <h2>Médias por {period === 'day' ? 'dia' : period === 'week' ? 'semana' : 'mês'}</h2>
          <table className="r-table">
            <thead><tr><th>Período</th><th>Leituras</th><th>Jejum</th><th>2 h após almoço</th><th>2 h após janta</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td>{groupLabel(g.key, period)}</td>
                  <td>{g.all.count}</td>
                  {cats.map((c) => {
                    const m = g.byCategory[c].mean;
                    const st = m === null ? null : statusOf(m, c, settings);
                    return <td key={c}>{m === null ? '—' : <span className={`pill r-${st}`}>{Math.round(m)}</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Todas as medições</h2>
          <table className="r-table">
            <thead><tr><th>Data</th><th>Hora</th><th>mg/dL</th><th>Situação</th><th>Momento</th></tr></thead>
            <tbody>
              {[...byDay.entries()].reverse().flatMap(([day, list]) =>
                [...list].reverse().map((r, i) => {
                  const c = classify(r.time, settings);
                  const st = statusOf(r.mgdl, c, settings);
                  return (
                    <tr key={r.key}>
                      <td>{i === 0 ? br(day) : ''}</td>
                      <td>{r.time.slice(11, 16)}</td>
                      <td><span className={`pill r-${st}`}>{r.mgdl}</span></td>
                      <td className={`t-${st}`}>{STATUS_TEXT[st]}</td>
                      <td><i className="d" style={{ background: COLOR[c] }} /> {CATEGORY_LABEL[c]}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </>
      )}

      <p className="r-note">
        Horários do medidor (CareTech Precision 984) com o ajuste de fuso informado por ele. Metas de referência configuradas no app
        (jejum {settings.targets.jejum[0]}–{settings.targets.jejum[1]}; pós-refeição {settings.targets.almoco[0]}–{settings.targets.almoco[1]} mg/dL).
        Este relatório é informativo e não substitui a orientação do seu médico.
      </p>
    </div>
  );
}
