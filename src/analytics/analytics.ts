/**
 * Classificação e estatísticas das glicemias. Tudo em horário local "ingênuo"
 * (string "YYYY-MM-DDTHH:mm:ss" já com o Time Offset aplicado), sem conversão de fuso.
 */

export interface Reading {
  key: string;
  /** "YYYY-MM-DDTHH:mm:ss", horário local (base + offset). */
  time: string;
  mgdl: number;
  sequence?: number;
}

export type Category = 'jejum' | 'almoco' | 'janta' | 'outra';
export const CATEGORIES: Category[] = ['jejum', 'almoco', 'janta', 'outra'];
export const CATEGORY_LABEL: Record<Category, string> = {
  jejum: 'Jejum',
  almoco: '2 h após almoço',
  janta: '2 h após janta',
  outra: 'Outras',
};

/** Janelas em minutos desde 00:00, [início, fim). */
export interface Settings {
  windows: Record<Exclude<Category, 'outra'>, [number, number]>;
  /** Faixa alvo [mín, máx] em mg/dL, configurável pelo usuário. */
  targets: Record<Exclude<Category, 'outra'>, [number, number]>;
}

export const DEFAULT_SETTINGS: Settings = {
  windows: {
    jejum: [4 * 60, 10 * 60 + 30],
    almoco: [13 * 60, 16 * 60],
    janta: [19 * 60 + 30, 23 * 60],
  },
  // Valores iniciais editáveis; combine as metas com seu médico.
  targets: { jejum: [70, 130], almoco: [70, 180], janta: [70, 180] },
};

export const minutesOfDay = (time: string): number => {
  const m = /T(\d{2}):(\d{2})/.exec(time);
  if (!m) throw new Error(`Horário inválido: ${time}`);
  return +m[1] * 60 + +m[2];
};

export function classify(time: string, s: Settings = DEFAULT_SETTINGS): Category {
  const t = minutesOfDay(time);
  for (const c of ['jejum', 'almoco', 'janta'] as const) {
    const [a, b] = s.windows[c];
    if (t >= a && t < b) return c;
  }
  return 'outra';
}

export interface Summary {
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** % de leituras dentro da faixa alvo (null se não há alvo, como em "Outras"). */
  inRangePct: number | null;
}

export function summarize(values: number[], target?: [number, number]): Summary {
  if (!values.length) return { count: 0, mean: null, min: null, max: null, inRangePct: null };
  const sum = values.reduce((a, b) => a + b, 0);
  const inRange = target ? values.filter((v) => v >= target[0] && v <= target[1]).length : null;
  return {
    count: values.length,
    mean: Math.round((sum / values.length) * 10) / 10,
    min: Math.min(...values),
    max: Math.max(...values),
    inRangePct: inRange === null ? null : Math.round((inRange / values.length) * 1000) / 10,
  };
}

export interface CategorySummaries {
  all: Summary;
  byCategory: Record<Category, Summary>;
}

export function summarizeByCategory(readings: Reading[], s: Settings = DEFAULT_SETTINGS): CategorySummaries {
  const buckets: Record<Category, number[]> = { jejum: [], almoco: [], janta: [], outra: [] };
  for (const r of readings) buckets[classify(r.time, s)].push(r.mgdl);
  return {
    all: summarize(readings.map((r) => r.mgdl)),
    byCategory: {
      jejum: summarize(buckets.jejum, s.targets.jejum),
      almoco: summarize(buckets.almoco, s.targets.almoco),
      janta: summarize(buckets.janta, s.targets.janta),
      outra: summarize(buckets.outra),
    },
  };
}

/* ---------------- Períodos ---------------- */

export type Period = 'day' | 'week' | 'month' | 'year';

const dateOf = (t: string) => t.slice(0, 10);

/** Segunda-feira (ISO) da semana de uma data "YYYY-MM-DD". */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // segunda = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

export function periodKey(time: string, p: Period): string {
  const d = dateOf(time);
  if (p === 'day') return d;
  if (p === 'week') return weekStart(d);
  if (p === 'month') return d.slice(0, 7);
  return d.slice(0, 4);
}

export interface PeriodGroup extends CategorySummaries {
  key: string;
  readings: Reading[];
}

export function groupByPeriod(readings: Reading[], p: Period, s: Settings = DEFAULT_SETTINGS): PeriodGroup[] {
  const map = new Map<string, Reading[]>();
  for (const r of readings) {
    const k = periodKey(r.time, p);
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, rs]) => ({ key, readings: rs, ...summarizeByCategory(rs, s) }));
}

/** Filtro por faixa de datas inclusiva ("YYYY-MM-DD"). */
export function filterRange<T extends Reading>(readings: T[], from?: string, to?: string): T[] {
  return readings.filter((r) => {
    const d = dateOf(r.time);
    return (!from || d >= from) && (!to || d <= to);
  });
}

export interface Comparison {
  a: CategorySummaries;
  b: CategorySummaries;
  /** b - a da média, por categoria (null se faltar dado). */
  meanDelta: Record<Category, number | null>;
}

export function compareRanges(
  readings: Reading[],
  a: { from: string; to: string },
  b: { from: string; to: string },
  s: Settings = DEFAULT_SETTINGS,
): Comparison {
  const sa = summarizeByCategory(filterRange(readings, a.from, a.to), s);
  const sb = summarizeByCategory(filterRange(readings, b.from, b.to), s);
  const delta = {} as Record<Category, number | null>;
  for (const c of CATEGORIES) {
    const ma = sa.byCategory[c].mean;
    const mb = sb.byCategory[c].mean;
    delta[c] = ma === null || mb === null ? null : Math.round((mb - ma) * 10) / 10;
  }
  return { a: sa, b: sb, meanDelta: delta };
}

/* ---------------- Status e período anterior ---------------- */

export type Status = 'low' | 'ok' | 'high';
/** Abaixo disto é sempre "baixo", mesmo que a meta configurada seja menor. */
export const LOW_LIMIT = 70;

export function statusOf(mgdl: number, c: Category, s: Settings = DEFAULT_SETTINGS): Status {
  const [lo, hi] = c === 'outra' ? [LOW_LIMIT, 180] : s.targets[c];
  if (mgdl < LOW_LIMIT || mgdl < lo) return 'low';
  return mgdl > hi ? 'high' : 'ok';
}

const addDaysIso = (d: string, n: number) =>
  new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

/** Período de mesma duração imediatamente anterior a [from, to]. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1;
  const prevTo = addDaysIso(from, -1);
  return { from: addDaysIso(prevTo, -(days - 1)), to: prevTo };
}

/** Normaliza o formato de data/hora do script Python ("YYYY-MM-DD HH:MM:SS") para ISO ingênuo. */
export const normalizeTime = (t: string) => t.trim().replace(' ', 'T').slice(0, 19);
