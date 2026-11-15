import {
  a1cFromMean,
  annotate,
  CATEGORY_LABEL,
  calibrateWithExam,
  eagFromA1c,
  estimateA1c,
  classify,
  compareRanges,
  DEFAULT_SETTINGS,
  filterRange,
  groupByPeriod,
  inWindow,
  linearTrend,
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
  it('jejum, almoço, jantar e extras (janelas sem buracos entre si)', () => {
    expect(classify('2026-11-13T07:30:00')).toBe('jejum');
    expect(classify('2026-11-13T14:10:00')).toBe('almoco');
    expect(classify('2026-11-13T16:03:00')).toBe('almoco'); // antes caía fora da janela
    expect(classify('2026-11-13T17:29:00')).toBe('almoco');
    expect(classify('2026-11-13T17:30:00')).toBe('janta');
    expect(classify('2026-11-13T21:05:00')).toBe('janta');
    expect(classify('2026-11-13T02:00:00')).toBe('outra');
  });
  it('limites: início inclusivo, fim exclusivo', () => {
    expect(classify('2026-11-13T04:00:00')).toBe('jejum');
    expect(classify('2026-11-13T10:29:00')).toBe('jejum');
    expect(classify('2026-11-13T10:30:00')).toBe('almoco');
  });
  it('janta passa da meia-noite: 00:22 conta como jantar', () => {
    expect(classify('2026-11-14T00:22:00')).toBe('janta');
    expect(classify('2026-11-13T23:40:00')).toBe('janta');
    expect(classify('2026-11-14T00:59:00')).toBe('janta');
    expect(classify('2026-11-14T01:00:00')).toBe('outra'); // fim exclusivo
    expect(classify('2026-11-14T03:10:00')).toBe('outra');
  });
  it('janela comum não é afetada pela lógica de meia-noite', () => {
    expect(inWindow(8 * 60, [4 * 60, 10 * 60])).toBe(true);
    expect(inWindow(11 * 60, [4 * 60, 10 * 60])).toBe(false);
  });
  it('respeita janelas personalizadas', () => {
    const s = { ...DEFAULT_SETTINGS, windows: { ...DEFAULT_SETTINGS.windows, almoco: [11 * 60, 12 * 60] as [number, number] } };
    expect(classify('2026-11-13T11:30:00', s)).toBe('almoco');
  });
});

describe('annotate: sugestão, escolha manual e dia da refeição', () => {
  const at = (time: string, mgdl: number, extra: Partial<Reading> = {}): Reading => ({ key: time, time, mgdl, ...extra });
  const by = (rs: ReturnType<typeof annotate>, time: string) => rs.find((x) => x.time === time)!;

  it('o jantar medido depois da meia-noite pertence ao dia anterior (3 medições de "hoje")', () => {
    const rs = annotate([
      at('2026-11-14T00:22:00', 160), // jantar de ontem, medido após a meia-noite
      at('2026-11-14T07:00:00', 150),
      at('2026-11-14T16:03:00', 140),
      at('2026-11-14T22:31:00', 130),
    ]);
    expect(by(rs, '2026-11-14T00:22:00')).toMatchObject({ category: 'janta', day: '2026-11-13' });
    expect(by(rs, '2026-11-14T07:00:00')).toMatchObject({ category: 'jejum', day: '2026-11-14' });
    expect(by(rs, '2026-11-14T16:03:00')).toMatchObject({ category: 'almoco', day: '2026-11-14' });
    expect(by(rs, '2026-11-14T22:31:00')).toMatchObject({ category: 'janta', day: '2026-11-14' });
    // "Hoje": só as 3 medições do dia, sem a da madrugada
    expect(filterRange(rs, '2026-11-14', '2026-11-14').map((x) => x.mgdl)).toEqual([150, 140, 130]);
    // e o cartão do jantar de hoje não mistura as duas
    expect(summarizeByCategory(filterRange(rs, '2026-11-14', '2026-11-14')).byCategory.janta.mean).toBe(130);
  });

  it('6 medições no dia: sugere uma por momento (a mais perto do horário típico) e marca o conflito', () => {
    const rs = annotate([
      at('2026-11-14T07:00:00', 150),
      at('2026-11-14T08:30:00', 151),
      at('2026-11-14T12:00:00', 152),
      at('2026-11-14T16:03:00', 153),
      at('2026-11-14T18:00:00', 154),
      at('2026-11-14T22:31:00', 155),
    ]);
    expect(by(rs, '2026-11-14T07:00:00')).toMatchObject({ suggested: 'jejum', conflict: true });
    expect(by(rs, '2026-11-14T08:30:00')).toMatchObject({ suggested: 'outra', conflict: true });
    expect(by(rs, '2026-11-14T16:03:00')).toMatchObject({ suggested: 'almoco' });
    expect(by(rs, '2026-11-14T12:00:00')).toMatchObject({ suggested: 'outra' });
    expect(by(rs, '2026-11-14T22:31:00')).toMatchObject({ suggested: 'janta' });
    expect(by(rs, '2026-11-14T18:00:00')).toMatchObject({ suggested: 'outra' });
    expect(rs.filter((x) => x.category !== 'outra')).toHaveLength(3);
  });

  it('o horário usual é configurável e decide a sugestão', () => {
    const rs = [at('2026-11-14T12:00:00', 152), at('2026-11-14T16:03:00', 153)];
    // padrão (almoço usual 15:00): vale o das 16:03
    expect(annotate(rs).map((x) => x.suggested)).toEqual(['outra', 'almoco']);
    // quem almoça cedo e mede às 12:00 muda o horário usual e a sugestão acompanha
    const cedo = { ...DEFAULT_SETTINGS, usual: { ...DEFAULT_SETTINGS.usual!, almoco: 12 * 60 + 30 } };
    expect(annotate(rs, cedo).map((x) => x.suggested)).toEqual(['almoco', 'outra']);
  });

  it('sem disputa não há conflito', () => {
    const rs = annotate([at('2026-11-14T07:00:00', 150), at('2026-11-14T16:03:00', 140)]);
    expect(rs.every((x) => !x.conflict)).toBe(true);
  });

  it('a escolha manual vence e libera as outras como extras', () => {
    const rs = annotate([
      at('2026-11-14T12:00:00', 152, { manual: 'almoco' }),
      at('2026-11-14T16:03:00', 153),
    ]);
    expect(by(rs, '2026-11-14T12:00:00')).toMatchObject({ category: 'almoco', conflict: false });
    expect(by(rs, '2026-11-14T16:03:00')).toMatchObject({ suggested: 'outra', category: 'outra', conflict: false });
  });

  it('o usuário pode forçar qualquer momento, até fora da janela', () => {
    const rs = annotate([at('2026-11-14T09:00:00', 150, { manual: 'janta' })]);
    expect(rs[0].category).toBe('janta');
    expect(rs[0].day).toBe('2026-11-14'); // 09:00 já é depois do início do jejum: mesmo dia
  });

  it('jantar escolhido de madrugada (antes do jejum) vai para o dia anterior', () => {
    const rs = annotate([at('2026-11-14T03:30:00', 150, { manual: 'janta' }), at('2026-11-14T05:00:00', 150, { manual: 'janta' })]);
    expect(rs[0].day).toBe('2026-11-13');
    expect(rs[1].day).toBe('2026-11-14');
  });

  it('dois dias diferentes não disputam o mesmo momento', () => {
    const rs = annotate([at('2026-11-13T22:00:00', 150), at('2026-11-14T22:00:00', 151)]);
    expect(rs.map((x) => x.suggested)).toEqual(['janta', 'janta']);
    expect(rs.every((x) => !x.conflict)).toBe(true);
  });

  it('agrupa por dia da refeição (o jantar da madrugada fica no dia anterior)', () => {
    const rs = annotate([at('2026-11-14T00:22:00', 160), at('2026-11-14T07:00:00', 150)]);
    const g = groupByPeriod(rs, 'day');
    expect(g.map((x) => x.key)).toEqual(['2026-11-13', '2026-11-14']);
    expect(g[0].byCategory.janta.count).toBe(1);
  });

  it('nomes: Almoço, Jantar e Extras', () => {
    expect([CATEGORY_LABEL.jejum, CATEGORY_LABEL.almoco, CATEGORY_LABEL.janta, CATEGORY_LABEL.outra]).toEqual(['Jejum', 'Almoço', 'Jantar', 'Extras']);
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
  it('padrões seguem a SBD: jejum 80–130, pós-refeição até 180, HbA1c < 7%', () => {
    expect(DEFAULT_SETTINGS.targets.jejum).toEqual([80, 130]);
    expect(DEFAULT_SETTINGS.targets.almoco[1]).toBe(180);
    expect(DEFAULT_SETTINGS.targets.janta[1]).toBe(180);
    expect(DEFAULT_SETTINGS.a1cTarget).toBe(7);
    expect(statusOf(79, 'jejum')).toBe('low');
    expect(statusOf(80, 'jejum')).toBe('ok');
  });
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

describe('linearTrend', () => {
  it('reta exata y = 2x + 1', () => {
    const t = linearTrend([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }])!;
    expect(t.slope).toBeCloseTo(2, 10);
    expect(t.intercept).toBeCloseTo(1, 10);
  });
  it('valores constantes dão inclinação zero', () => {
    const t = linearTrend([{ x: 0, y: 130 }, { x: 5, y: 130 }, { x: 9, y: 130 }])!;
    expect(t.slope).toBeCloseTo(0, 10);
    expect(t.intercept).toBeCloseTo(130, 10);
  });
  it('funciona com x em milissegundos (números grandes)', () => {
    const t0 = Date.UTC(2026, 10, 1);
    const day = 86_400_000;
    const t = linearTrend([0, 1, 2, 3].map((i) => ({ x: t0 + i * day, y: 100 + 10 * i })))!;
    expect(t.slope * day).toBeCloseTo(10, 6);
  });
  it('menos de 3 pontos ou x repetido não tem tendência', () => {
    expect(linearTrend([{ x: 0, y: 1 }, { x: 1, y: 2 }])).toBeNull();
    expect(linearTrend([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }])).toBeNull();
  });
});

describe('HbA1c estimada', () => {
  it('fórmula ADAG nos dois sentidos', () => {
    expect(a1cFromMean(154)).toBeCloseTo(7.0, 1);
    expect(eagFromA1c(7)).toBeCloseTo(154.2, 1);
    expect(a1cFromMean(eagFromA1c(6.4))).toBeCloseTo(6.4, 5);
  });
  const mk = (n: number, day0: string, mg: number): Reading[] =>
    Array.from({ length: n }, (_, i) => r(`${new Date(Date.parse(day0 + 'T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10)}T08:00:00`, mg));
  it('usa só a janela de 90 dias terminando na data', () => {
    const data = [...mk(10, '2026-01-01', 300), ...mk(10, '2026-10-01', 154)];
    const e = estimateA1c(data, '2026-10-10')!;
    expect(e.count).toBe(10);
    expect(e.mean).toBe(154);
    expect(e.a1c).toBe(7);
    expect(e.windowFrom).toBe('2026-07-13');
  });
  it('sem leituras na janela não estima', () => {
    expect(estimateA1c(mk(5, '2025-01-01', 150), '2026-10-10')).toBeNull();
  });
  it('cobertura: poucos dias = confiança baixa', () => {
    expect(estimateA1c(mk(5, '2026-10-01', 150), '2026-10-10')!.confidence).toBe('baixa');
    expect(estimateA1c(mk(50, '2026-08-20', 150), '2026-10-10')!.confidence).toBe('razoável');
  });
  it('calibra com o exame: diferença = exame - estimativa da época', () => {
    const data = mk(30, '2026-08-01', 154); // estimativa ≈ 7,0
    const c = calibrateWithExam(data, { value: 6.6, date: '2026-08-30' })!;
    expect(c.atExam.a1c).toBe(7);
    expect(c.delta).toBe(-0.4);
  });
  it('calibração sem leituras na época do exame retorna null', () => {
    expect(calibrateWithExam(mk(5, '2026-10-01', 150), { value: 7, date: '2025-01-01' })).toBeNull();
  });
});

describe('normalizeTime', () => {
  it('aceita o formato do script Python', () => {
    expect(normalizeTime('2026-11-13 13:51:07')).toBe('2026-11-13T13:51:07');
    expect(normalizeTime('2026-11-13T13:51:07')).toBe('2026-11-13T13:51:07');
  });
});
