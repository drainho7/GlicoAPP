import {
  classify,
  compareRanges,
  DEFAULT_SETTINGS,
  filterRange,
  groupByPeriod,
  normalizeTime,
  periodKey,
  previousRange,
  Reading,
  statusOf,
  summarize,
  summarizeByCategory,
  weekStart,
} from '../analytics';

const r = (time: string, mgdl: number, key = time): Reading => ({ key, time, mgdl });

describe('classify', () => {
  it('jejum, almoço, janta e outras', () => {
    expect(classify('2026-11-13T07:30:00')).toBe('jejum');
    expect(classify('2026-11-13T14:10:00')).toBe('almoco');
    expect(classify('2026-11-13T21:05:00')).toBe('janta');
    expect(classify('2026-11-13T17:00:00')).toBe('outra');
    expect(classify('2026-11-13T02:00:00')).toBe('outra');
  });
  it('limites: início inclusivo, fim exclusivo', () => {
    expect(classify('2026-11-13T04:00:00')).toBe('jejum');
    expect(classify('2026-11-13T10:30:00')).toBe('outra');
  });
  it('respeita janelas personalizadas', () => {
    const s = { ...DEFAULT_SETTINGS, windows: { ...DEFAULT_SETTINGS.windows, almoco: [11 * 60, 12 * 60] as [number, number] } };
    expect(classify('2026-11-13T11:30:00', s)).toBe('almoco');
  });
});

describe('summarize', () => {
  it('vazio', () => {
    expect(summarize([])).toEqual({ count: 0, mean: null, min: null, max: null, inRangePct: null });
  });
  it('média, min, max e % na faixa', () => {
    expect(summarize([100, 120, 200], [70, 130])).toEqual({ count: 3, mean: 140, min: 100, max: 200, inRangePct: 66.7 });
  });
  it('sem alvo não calcula faixa', () => {
    expect(summarize([100]).inRangePct).toBeNull();
  });
});

describe('períodos', () => {
  it('semana começa na segunda', () => {
    expect(weekStart('2026-11-13')).toBe('2026-11-09'); // sexta
    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // segunda
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // domingo
    expect(weekStart('2026-01-01')).toBe('2025-12-29'); // cruza o ano
  });
  it('chaves de período', () => {
    expect(periodKey('2026-11-13T07:00:00', 'day')).toBe('2026-11-13');
    expect(periodKey('2026-11-13T07:00:00', 'month')).toBe('2026-11');
    expect(periodKey('2026-11-13T07:00:00', 'year')).toBe('2026');
  });
  it('agrupa por mês e ordena', () => {
    const data = [r('2026-11-10T08:00:00', 130), r('2026-10-01T08:00:00', 100), r('2026-11-11T08:00:00', 110)];
    const g = groupByPeriod(data, 'month');
    expect(g.map((x) => x.key)).toEqual(['2026-10', '2026-11']);
    expect(g[1].byCategory.jejum.mean).toBe(120);
    expect(g[1].all.count).toBe(2);
  });
});

describe('faixa de datas e comparativo', () => {
  const data = [
    r('2026-10-01T08:00:00', 150),
    r('2026-10-02T14:00:00', 200),
    r('2026-11-01T08:00:00', 120),
    r('2026-11-02T14:00:00', 160),
  ];
  it('filtro inclusivo', () => {
    expect(filterRange(data, '2026-10-02', '2026-11-01').map((x) => x.mgdl)).toEqual([200, 120]);
  });
  it('compara médias por categoria', () => {
    const c = compareRanges(data, { from: '2026-10-01', to: '2026-10-31' }, { from: '2026-11-01', to: '2026-11-30' });
    expect(c.meanDelta.jejum).toBe(-30);
    expect(c.meanDelta.almoco).toBe(-40);
    expect(c.meanDelta.janta).toBeNull();
  });
  it('resumo por categoria soma o total', () => {
    expect(summarizeByCategory(data).all.count).toBe(4);
  });
});

describe('statusOf e previousRange', () => {
  it('status por meta da categoria', () => {
    expect(statusOf(100, 'jejum')).toBe('ok');
    expect(statusOf(131, 'jejum')).toBe('high');
    expect(statusOf(181, 'almoco')).toBe('high');
    expect(statusOf(69, 'janta')).toBe('low');
  });
  it('abaixo de 70 é sempre baixo, mesmo com meta menor', () => {
    const s = { ...DEFAULT_SETTINGS, targets: { ...DEFAULT_SETTINGS.targets, jejum: [50, 130] as [number, number] } };
    expect(statusOf(65, 'jejum', s)).toBe('low');
  });
  it('"outras" usa 70–180', () => {
    expect(statusOf(150, 'outra')).toBe('ok');
    expect(statusOf(200, 'outra')).toBe('high');
  });
  it('período anterior tem a mesma duração', () => {
    expect(previousRange('2026-11-07', '2026-11-13')).toEqual({ from: '2026-10-31', to: '2026-11-06' });
    expect(previousRange('2026-03-01', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' });
  });
});

describe('normalizeTime', () => {
  it('aceita o formato do script Python', () => {
    expect(normalizeTime('2026-11-13 13:51:07')).toBe('2026-11-13T13:51:07');
    expect(normalizeTime('2026-11-13T13:51:07')).toBe('2026-11-13T13:51:07');
  });
});
