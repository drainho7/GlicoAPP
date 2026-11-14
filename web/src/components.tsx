import React, { useEffect, useMemo, useState } from 'react';
import {
  calibrateWithExam,
  CATEGORIES,
  CATEGORY_LABEL,
  Category,
  classify,
  DEFAULT_SETTINGS,
  estimateA1c,
  filterRange,
  groupByPeriod,
  linearTrend,
  Period,
  Settings,
  Status,
  statusOf,
  summarizeByCategory,
} from '../../src/analytics/analytics';
import { Chart, Series } from './Chart';
import { addDays, dayHeading, friendlyTime, groupLabel, shortDate } from './format';
import { StoredReading } from './store';

/** Cor da linha "Geral": acompanha o texto do tema (clara no escuro, escura no claro). */
const GERAL_COLOR = 'var(--fg)';
export const COLOR: Record<Category, string> = { jejum: '#42a5f5', almoco: '#ffca28', janta: '#ba68c8', outra: '#9e9e9e' };
const STATUS_TEXT: Record<Status, string> = { ok: 'Dentro da meta', high: 'Acima da meta', low: 'Abaixo da meta' };
const toMs = (t: string) => Date.parse(t + 'Z'); // só posiciona no eixo; sem conversão de fuso
const fmt = (n: number | null) => (n === null ? '—' : String(Math.round(n)));

/* ---------------- Cabeçalho: última leitura + importar ---------------- */

export function Hero({
  last,
  settings,
  busy,
  onImport,
}: {
  last?: StoredReading;
  settings: Settings;
  busy: boolean;
  onImport: () => void;
}) {
  const c = last ? classify(last.time, settings) : null;
  const st = last && c ? statusOf(last.mgdl, c, settings) : null;
  return (
    <section className="hero card">
      <div>
        <div className="muted">Última medição</div>
        {last && c && st ? (
          <>
            <div className={`big s-${st}`}>
              {last.mgdl}
              <small> mg/dL</small>
            </div>
            <div>{friendlyTime(last.time)}</div>
            <div className="muted">
              {CATEGORY_LABEL[c]} · <span className={`s-${st}`}>{STATUS_TEXT[st]}</span>
            </div>
          </>
        ) : (
          <div className="big muted">—</div>
        )}
      </div>
      <button className="primary" onClick={onImport} disabled={busy}>
        {busy ? 'Importando…' : '⟳ Importar do medidor'}
      </button>
    </section>
  );
}

/* ---------------- Período ---------------- */

export type Preset = '7' | '30' | '90' | '365' | 'all' | 'custom';
const PRESETS: [Preset, string][] = [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['365', '1 ano'], ['all', 'Tudo'], ['custom', 'Datas…']];

/** Converte a escolha de período em datas. "N dias" contam para trás a partir da última leitura. */
export function rangeFor(preset: Preset, anchor: string, cFrom: string, cTo: string): { from?: string; to?: string } {
  if (preset === 'all') return {};
  if (preset === 'custom') return { from: cFrom || undefined, to: cTo || undefined };
  return { from: addDays(anchor, -(Number(preset) - 1)), to: anchor };
}

export function PeriodPicker({
  preset,
  setPreset,
  from,
  to,
  setFrom,
  setTo,
  onPdf,
  summary,
}: {
  preset: Preset;
  setPreset: (p: Preset) => void;
  from: string;
  to: string;
  setFrom: (s: string) => void;
  setTo: (s: string) => void;
  onPdf: () => void;
  summary: string;
}) {
  return (
    <div className="picker">
      <div className="chips">
        {PRESETS.map(([k, l]) => (
          <button key={k} className={preset === k ? 'chip on' : 'chip'} onClick={() => setPreset(k)}>
            {l}
          </button>
        ))}
        <button className="chip pdf" onClick={onPdf}>📄 Relatório PDF</button>
      </div>
      {preset === 'custom' && (
        <div className="dates">
          <label>De <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>até <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      )}
      <p className="muted period-note">Exibindo {summary}. Vale para os cartões, o gráfico e o histórico.</p>
    </div>
  );
}

/* ---------------- Janela "Relatório em PDF": escolher o período ---------------- */

export function ReportDialog({
  readings,
  anchor,
  onClose,
  onConfirm,
}: {
  readings: StoredReading[];
  anchor: string;
  onClose: () => void;
  onConfirm: (r: { from?: string; to?: string }) => void;
}) {
  const [preset, setPreset] = useState<Preset>('30');
  const [cFrom, setCFrom] = useState(addDays(anchor, -29));
  const [cTo, setCTo] = useState(anchor);
  const range = rangeFor(preset, anchor, cFrom, cTo);
  const count = filterRange(readings, range.from, range.to).length;
  const invalid = preset === 'custom' && (!cFrom || !cTo || cFrom > cTo);
  const label = range.from && range.to ? `${brDate(range.from)} a ${brDate(range.to)}` : 'Todas as leituras';
  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dialog card" onClick={(e) => e.stopPropagation()}>
        <h2>Relatório em PDF</h2>
        <p className="muted">Escolha o período que o relatório deve cobrir.</p>
        <div className="chips center">
          {PRESETS.map(([k, l]) => (
            <button key={k} className={preset === k ? 'chip on' : 'chip'} onClick={() => setPreset(k)}>{l}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="dates center">
            <label>De <input type="date" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)} /></label>
            <label>até <input type="date" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)} /></label>
          </div>
        )}
        <p className="report-range">
          <b>{invalid ? 'Confira as datas' : label}</b>
          {!invalid && <span className="muted"> · {count} {count === 1 ? 'leitura' : 'leituras'}</span>}
        </p>
        {!invalid && count === 0 && <p className="muted">Não há leituras nesse período.</p>}
        <div className="row2 center">
          <button className="chip" onClick={onClose}>Cancelar</button>
          <button className="primary small" disabled={invalid || count === 0} onClick={() => onConfirm(range)}>Pré-visualizar</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Cartões por refeição ---------------- */

export function CategoryCards({
  current,
  previous,
  settings,
  selected,
  onSelect,
}: {
  current: StoredReading[];
  previous: StoredReading[] | null;
  settings: Settings;
  selected: Category | 'todas';
  onSelect: (c: Category | 'todas') => void;
}) {
  const cur = useMemo(() => summarizeByCategory(current, settings), [current, settings]);
  const prev = useMemo(() => (previous ? summarizeByCategory(previous, settings) : null), [previous, settings]);
  const cats = ['jejum', 'almoco', 'janta'] as const;
  return (
    <div className="cards3">
      {cats.map((c) => {
        const s = cur.byCategory[c];
        const pm = prev?.byCategory[c].mean ?? null;
        const delta = s.mean !== null && pm !== null ? Math.round(s.mean - pm) : null;
        const [lo, hi] = settings.targets[c];
        return (
          <button
            key={c}
            className={`card cat ${selected === c ? 'sel' : ''}`}
            style={{ ['--accent' as string]: COLOR[c] }}
            onClick={() => onSelect(selected === c ? 'todas' : c)}
            aria-pressed={selected === c}
          >
            <div className="cat-title"><span className="dot" /> {CATEGORY_LABEL[c]}</div>
            <div className="avg">{fmt(s.mean)}<small> mg/dL</small></div>
            <div className="muted">média · {s.count} leitura{s.count === 1 ? '' : 's'}</div>
            {s.inRangePct !== null && (
              <div className="meta">
                <div className="bar"><div style={{ width: `${s.inRangePct}%` }} /></div>
                <span>{Math.round(s.inRangePct)}% na meta ({lo}–{hi})</span>
              </div>
            )}
            {delta !== null && (
              <div className="muted">
                {delta === 0 ? '= igual' : delta > 0 ? `▲ +${delta}` : `▼ ${delta}`} vs período anterior
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Gráfico ---------------- */

type View = 'leituras' | Period;
const VIEWS: [View, string][] = [['leituras', 'Cada leitura'], ['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês'], ['year', 'Ano']];

export function ChartSection({
  readings,
  settings,
  category,
}: {
  readings: StoredReading[];
  settings: Settings;
  category: Category | 'todas';
}) {
  const [view, setView] = useState<View>('leituras');
  const shown: Category[] = category === 'todas' ? ['jejum', 'almoco', 'janta'] : [];
  const band = category === 'todas' || category === 'outra' ? undefined : settings.targets[category];

  const groups = useMemo(() => (view === 'leituras' ? [] : groupByPeriod(readings, view, settings)), [readings, view, settings]);

  type Pt = { x: number; y: number };
  const notNull = (p: { x: number; y: number | null }): p is Pt => p.y !== null;
  const pointsFor = (c: Category | 'todas'): Pt[] =>
    view === 'leituras'
      ? readings.filter((r) => c === 'todas' || classify(r.time, settings) === c).map((r) => ({ x: toMs(r.time), y: r.mgdl }))
      : groups.map((g, i) => ({ x: i, y: c === 'todas' ? g.all.mean : g.byCategory[c].mean })).filter(notNull);

  // "Geral": todas as leituras juntas (inclusive as fora das janelas de horário), numa linha contínua.
  // Com um momento selecionado, a linha principal passa a ser a dele. A tendência é uma reta linear tracejada.
  const mainName = category === 'todas' ? 'Geral' : CATEGORY_LABEL[category];
  const mainColor = category === 'todas' ? GERAL_COLOR : COLOR[category];
  const mainPoints = pointsFor(category);
  const trend = linearTrend(mainPoints);
  const xs = mainPoints.map((p) => p.x);
  const trendSeries: Series[] = trend
    ? [{
        name: 'Tendência',
        color: mainColor,
        line: true,
        dashed: true,
        noDots: true,
        points: [Math.min(...xs), Math.max(...xs)].map((x) => ({ x, y: Math.round((trend.intercept + trend.slope * x) * 10) / 10 })),
      }]
    : [];

  const series: Series[] = [
    { name: mainName, color: mainColor, line: true, points: mainPoints },
    ...shown.map((c) => ({ name: CATEGORY_LABEL[c], color: COLOR[c], line: view !== 'leituras', points: pointsFor(c) })),
    ...trendSeries,
  ];

  return (
    <section className="card">
      <div className="section-head">
        <h2>Evolução</h2>
        <div className="chips small">
          {VIEWS.map(([k, l]) => (
            <button key={k} className={view === k ? 'chip on' : 'chip'} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}><span className="dot" style={{ background: s.color }} /> {s.name}</span>
        ))}
        {band && <span className="muted">faixa azul = meta {band[0]}–{band[1]}</span>}
      </div>
      <Chart
        series={series}
        band={band}
        xLabel={view === 'leituras' ? shortDate : (x) => (groups[Math.round(x)] ? groupLabel(groups[Math.round(x)].key, view) : '')}
      />
      {view !== 'leituras' && groups.length > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr><th>{VIEWS.find(([k]) => k === view)![1]}</th><th>Leituras</th><th>Jejum</th><th>Almoço</th><th>Janta</th></tr>
            </thead>
            <tbody>
              {[...groups].reverse().map((g) => (
                <tr key={g.key}>
                  <td>{groupLabel(g.key, view as Period)}</td>
                  <td>{g.all.count}</td>
                  <td>{fmt(g.byCategory.jejum.mean)}</td>
                  <td>{fmt(g.byCategory.almoco.mean)}</td>
                  <td>{fmt(g.byCategory.janta.mean)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------- HbA1c estimada (simulação) ---------------- */

const pc = (n: number) => n.toFixed(1).replace('.', ',');
const brDate = (d: string) => d.split('-').reverse().join('/');

export function A1cCard({ readings, settings }: { readings: StoredReading[]; settings: Settings }) {
  const last = readings[readings.length - 1]?.time.slice(0, 10);
  const est = useMemo(() => (last ? estimateA1c(readings, last) : null), [readings, last]);
  const exam = settings.exam;
  const cal = useMemo(() => (exam ? calibrateWithExam(readings, exam) : null), [readings, exam]);
  if (!est) return null;
  const adjusted = cal ? Math.max(3, Math.round((est.a1c + cal.delta) * 10) / 10) : null;
  return (
    <section className="card a1c">
      <div className="section-head">
        <h2>HbA1c estimada</h2>
        <span className="badge">simulação · não é exame</span>
      </div>
      <div className="a1c-row">
        <div>
          <div className="avg">{pc(est.a1c)}<small> %</small></div>
          <div className="muted">média de {Math.round(est.mean)} mg/dL · {est.count} leituras em {est.days} dias</div>
          <div className="muted">últimos 90 dias ({brDate(est.windowFrom)} a {brDate(est.windowTo)}) · cobertura {est.confidence}</div>
          <div className="muted">Meta da SBD para a maioria dos adultos: abaixo de {pc(settings.a1cTarget ?? DEFAULT_SETTINGS.a1cTarget!)}% (o seu médico pode individualizar)</div>
        </div>
        <div className="a1c-exam">
          {exam ? (
            <>
              <div className="muted">Seu último exame</div>
              <div className="avg">{pc(exam.value)}<small> % · {brDate(exam.date)}</small></div>
              {cal ? (
                <div className="muted">
                  Na época a estimativa dava {pc(cal.atExam.a1c)}% (diferença {cal.delta > 0 ? '+' : ''}{pc(cal.delta)}).
                  Estimativa ajustada por esse exame: <b>{pc(adjusted!)}%</b>
                </div>
              ) : (
                <div className="muted">Sem leituras suficientes na época do exame para comparar.</div>
              )}
            </>
          ) : (
            <div className="muted">Informe o resultado do seu último exame em <b>Ajustes</b> para comparar e ajustar a estimativa.</div>
          )}
        </div>
      </div>
      <p className="disclaimer">
        Só uma referência para acompanhar. A HbA1c de verdade vem do exame de laboratório; esta conta usa a média das suas glicemias e
        costuma errar com poucas medições por dia e muitas em jejum.
      </p>
    </section>
  );
}

/* ---------------- Histórico ---------------- */

const CAT_CHIPS: [Category | 'todas', string][] = [
  ['todas', 'Todas'],
  ['jejum', 'Jejum'],
  ['almoco', '2 h após almoço'],
  ['janta', '2 h após janta'],
];

export function CategoryChips({ selected, onSelect }: { selected: Category | 'todas'; onSelect: (c: Category | 'todas') => void }) {
  return (
    <div className="chips catchips">
      {CAT_CHIPS.map(([k, l]) => (
        <button key={k} className={selected === k ? 'chip on' : 'chip'} onClick={() => onSelect(k)}>{l}</button>
      ))}
    </div>
  );
}

export function History({
  readings,
  settings,
  category = 'todas',
}: {
  readings: StoredReading[];
  settings: Settings;
  category?: Category | 'todas';
}) {
  const [limit, setLimit] = useState(60);
  const rows = useMemo(
    () => [...readings].reverse().filter((r) => category === 'todas' || classify(r.time, settings) === category),
    [readings, category, settings],
  );
  const shown = rows.slice(0, limit);
  const byDay = new Map<string, StoredReading[]>();
  for (const r of shown) (byDay.get(r.time.slice(0, 10)) ?? byDay.set(r.time.slice(0, 10), []).get(r.time.slice(0, 10))!).push(r);

  if (!rows.length) return <p className="card muted">Nenhuma leitura neste período.</p>;
  return (
    <section>
      {[...byDay.entries()].map(([day, rs]) => (
        <div className="card day" key={day}>
          <h3>{dayHeading(day)}</h3>
          {rs.map((r) => {
            const c = classify(r.time, settings);
            const st = statusOf(r.mgdl, c, settings);
            return (
              <div className="item" key={r.key}>
                <span className={`pill s-${st}`}>{r.mgdl}</span>
                <span>{r.time.slice(11, 16)}</span>
                <span className="muted"><span className="dot" style={{ background: COLOR[c] }} /> {CATEGORY_LABEL[c]}</span>
              </div>
            );
          })}
        </div>
      ))}
      {rows.length > limit && (
        <button className="chip" onClick={() => setLimit(limit + 60)}>Mostrar mais ({rows.length - limit})</button>
      )}
    </section>
  );
}

/* ---------------- Ajustes ---------------- */

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };

const UPDATE_TEXT: Record<GlicoUpdateState['status'], string> = {
  dev: 'Atualizações só funcionam no app instalado.',
  'not-configured': 'Atualização automática ainda não configurada.',
  checking: 'Verificando…',
  none: 'Você já está na versão mais recente.',
  available: 'Há uma versão nova disponível.',
  downloading: 'Baixando atualização…',
  ready: 'Atualização pronta. Reinicie para instalar.',
  error: 'Não foi possível verificar agora.',
};

function AboutPanel() {
  const [version, setVersion] = useState('');
  const [up, setUp] = useState<GlicoUpdateState | null>(null);
  useEffect(() => {
    window.glico?.getVersion().then(setVersion).catch(() => {});
    return window.glico?.onUpdate(setUp);
  }, []);
  const g = window.glico;
  return (
    <div className="card">
      <h2>Sobre</h2>
      <p>Glico {version ? `versão ${version}` : '(versão web)'}</p>
      {g ? (
        <>
          <div className="row2">
            <button className="chip" onClick={async () => { setUp({ status: 'checking' }); setUp(await g.checkUpdate()); }}>Verificar atualizações</button>
            {up?.status === 'available' && <button className="primary small" onClick={() => g.downloadUpdate()}>Baixar {up.version}</button>}
            {up?.status === 'ready' && <button className="primary small" onClick={() => g.installUpdate()}>Reiniciar e atualizar</button>}
          </div>
          {up && (
            <p className="muted">
              {UPDATE_TEXT[up.status]}
              {up.status === 'downloading' && up.percent !== undefined ? ` ${up.percent}%` : ''}
              {up.status === 'error' && up.message ? ` (${up.message})` : ''}
            </p>
          )}
          <p className="muted">Backup automático das leituras em Documentos\Glico\backup.json.</p>
        </>
      ) : null}
    </div>
  );
}

function ExamForm({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [value, setValue] = useState(settings.exam ? String(settings.exam.value).replace('.', ',') : '');
  const [date, setDate] = useState(settings.exam?.date ?? '');
  const commit = (v: string, d: string) => {
    const n = Number(v.replace(',', '.'));
    if (v && d && Number.isFinite(n) && n >= 3 && n <= 20) onChange({ ...settings, exam: { value: Math.round(n * 10) / 10, date: d } });
    else if (!v && !d) onChange({ ...settings, exam: undefined });
  };
  return (
    <div className="card">
      <h2>Último exame de HbA1c</h2>
      <p className="muted">Digite o resultado do laboratório. Ele é usado só para comparar com a estimativa do app.</p>
      <div className="setrow">
        <b>Resultado (%)</b>
        <input inputMode="decimal" placeholder="ex.: 7,2" value={value} style={{ width: 90 }}
          onChange={(e) => { setValue(e.target.value); commit(e.target.value, date); }} />
      </div>
      <div className="setrow">
        <b>Data do exame</b>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); commit(value, e.target.value); }} />
      </div>
      <p className="muted saved">
        {settings.exam
          ? `✓ Salvo automaticamente: ${pc(settings.exam.value)}% em ${brDate(settings.exam.date)}`
          : 'Preencha o resultado e a data: o app salva sozinho.'}
      </p>
      {(value || date) && (
        <button className="danger" onClick={() => { setValue(''); setDate(''); onChange({ ...settings, exam: undefined }); }}>Remover exame</button>
      )}
    </div>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  onClear,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClear: () => void;
}) {
  const cats = ['jejum', 'almoco', 'janta'] as const;
  return (
    <section>
      <p className="muted autosave">✓ As alterações nesta tela são salvas automaticamente.</p>
      <AboutPanel />
      <div className="card">
        <h2>Horários das medições</h2>
        <p className="muted">
          Cada leitura é classificada pelo horário em que foi feita. Fora destas janelas, vira "Outras". Se o fim for menor que o
          início (ex.: 19:30 até 01:00), a janela passa da meia-noite.
        </p>
        {cats.map((c) => (
          <div className="setrow" key={c}>
            <b><span className="dot" style={{ background: COLOR[c] }} /> {CATEGORY_LABEL[c]}</b>
            <div>
              <input type="time" value={hhmm(settings.windows[c][0])}
                onChange={(e) => onChange({ ...settings, windows: { ...settings.windows, [c]: [toMin(e.target.value), settings.windows[c][1]] } })} />
              {' – '}
              <input type="time" value={hhmm(settings.windows[c][1])}
                onChange={(e) => onChange({ ...settings, windows: { ...settings.windows, [c]: [settings.windows[c][0], toMin(e.target.value)] } })} />
            </div>
          </div>
        ))}
      </div>
      <ExamForm settings={settings} onChange={onChange} />
      <div className="card">
        <h2>Metas</h2>
        <p className="muted">
          O padrão segue a Sociedade Brasileira de Diabetes (SBD) para adultos com diabetes: jejum e antes das refeições 80–130 mg/dL,
          2 h depois de comer abaixo de 180 e HbA1c abaixo de 7%. As metas são individuais: ajuste com o seu médico.
        </p>
        <div className="setrow">
          <b>HbA1c (%) abaixo de</b>
          <input type="number" step="0.1" value={settings.a1cTarget ?? DEFAULT_SETTINGS.a1cTarget}
            onChange={(e) => onChange({ ...settings, a1cTarget: Number(e.target.value) || DEFAULT_SETTINGS.a1cTarget })} />
        </div>
        <p className="muted">Glicemia (mg/dL):</p>
        {cats.map((c) => (
          <div className="setrow" key={c}>
            <b><span className="dot" style={{ background: COLOR[c] }} /> {CATEGORY_LABEL[c]}</b>
            <div>
              <input type="number" value={settings.targets[c][0]}
                onChange={(e) => onChange({ ...settings, targets: { ...settings.targets, [c]: [+e.target.value, settings.targets[c][1]] } })} />
              {' – '}
              <input type="number" value={settings.targets[c][1]}
                onChange={(e) => onChange({ ...settings, targets: { ...settings.targets, [c]: [settings.targets[c][0], +e.target.value] } })} />
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Restaurar padrões da SBD</h2>
        <p className="muted">Volta as metas de glicemia e de HbA1c para os valores acima. Não altera as suas leituras.</p>
        <button className="chip" onClick={() => onChange({ ...settings, targets: DEFAULT_SETTINGS.targets, a1cTarget: DEFAULT_SETTINGS.a1cTarget })}>
          Restaurar metas da SBD
        </button>
      </div>
      <div className="card">
        <h2>Dados</h2>
        <button className="danger" onClick={onClear}>Apagar dados deste computador</button>
        <p className="muted">Os dados ficam só neste computador. O medidor não é alterado.</p>
      </div>
    </section>
  );
}

/* ---------------- Diálogo de importação ---------------- */

export type ImportUi = { phase: 'closed' } | { phase: 'working' | 'done' | 'error'; text: string };

export function ImportDialog({ ui, onClose }: { ui: ImportUi; onClose: () => void }) {
  if (ui.phase === 'closed') return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog card">
        {ui.phase === 'working' && <div className="spinner" />}
        <h2>{ui.phase === 'working' ? 'Importando…' : ui.phase === 'done' ? 'Pronto!' : 'Não deu certo'}</h2>
        <p>{ui.text}</p>
        {ui.phase === 'working' && (
          <ol className="muted">
            <li>Ligue o Bluetooth do medidor.</li>
            <li>Escolha <b>meter+…</b> na janela do navegador.</li>
            <li>Aguarde: ele envia todas as leituras guardadas.</li>
          </ol>
        )}
        {ui.phase !== 'working' && <button className="primary" onClick={onClose}>OK</button>}
      </div>
    </div>
  );
}
