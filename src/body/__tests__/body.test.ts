import { bmiClass, fieldFor, mergeBody, metricDelta, parseBodyRows, parseCellTime } from '../body';

// Todos os valores abaixo são fictícios (apenas para testar o leitor da planilha).
const HEADER = [
  'Tempo', 'Peso(Kg)', 'IMC', 'Gordura(%)', 'Peso da gordura(Kg)',
  'Percentual da massa muscular esquelética(%)', 'Peso da massa muscular esquelética(Kg)',
  'Registro de massa muscular(%)', 'Peso da massa muscular(Kg)',
  'Água(%)', 'peso da água(Kg)', 'Gordura visceral', 'Metabolismo(kcal / dia)', 'Altura', 'Idade real',
];

describe('fieldFor: reconhece as colunas do app', () => {
  it('mapeia cada coluna do app para a métrica certa', () => {
    expect(HEADER.map(fieldFor)).toEqual([
      'time', 'weightKg', 'bmi', 'fatPct', 'fatKg', 'skeletalMusclePct', 'skeletalMuscleKg',
      'musclePct', 'muscleKg', 'waterPct', 'waterKg', 'visceralFat', 'bmrKcal', 'heightCm', 'age',
    ]);
  });
  it('colunas desconhecidas viram null', () => {
    expect(fieldFor('Observação')).toBeNull();
    expect(fieldFor('')).toBeNull();
  });
});

describe('parseCellTime', () => {
  it('Date do Excel (UTC) vira horário local ingênuo', () => {
    expect(parseCellTime(new Date(Date.UTC(2026, 10, 12, 7, 15, 0)))).toBe('2026-11-12T07:15:00');
  });
  it('arredonda ao segundo: 07:14:59,999 do Excel vira 07:15:00', () => {
    expect(parseCellTime(new Date(Date.UTC(2026, 10, 12, 7, 14, 59, 999)))).toBe('2026-11-12T07:15:00');
    // serial calculado em ponto flutuante cai um pouco abaixo da hora cheia
    expect(parseCellTime(46338 + 435 / 1440 - 1e-9)).toBe('2026-11-12T07:15:00');
  });
  it('ISO e dd/mm/aaaa', () => {
    expect(parseCellTime('2026-11-12 07:15:03')).toBe('2026-11-12T07:15:03');
    expect(parseCellTime('12/11/2026 07:15')).toBe('2026-11-12T07:15:00');
    expect(parseCellTime('05/03/2026')).toBe('2026-03-05T00:00:00');
  });
  it('mês/dia só quando o 2º número não pode ser mês', () => {
    expect(parseCellTime('11/25/2026 09:00')).toBe('2026-11-25T09:00:00');
  });
  it('número serial do Excel', () => {
    // 2026-11-12 07:15 => serial 46338 + 435/1440
    expect(parseCellTime(46338 + (7 * 60 + 15) / 1440)).toBe('2026-11-12T07:15:00');
  });
  it('inválidos retornam null', () => {
    expect(parseCellTime('ontem')).toBeNull();
    expect(parseCellTime(null)).toBeNull();
    expect(parseCellTime('32/13/2026')).toBeNull();
  });
});

describe('parseBodyRows', () => {
  const t1 = new Date(Date.UTC(2026, 10, 12, 7, 15));
  const rows: unknown[][] = [
    ['Fulano - hist.'], // linha de título antes do cabeçalho
    HEADER,
    [t1, 75.4, 25.3, 21.5, 16.2, 38.4, 28.9, 70.1, 52.8, 55.0, 41.5, 8, 1600, 172, 40],
    ['05/03/2026 13:52', '76,10', 25.7, '22,0', null, null, null, null, null, null, null, 9, 1610, 172, 40],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], // linha vazia
    ['data ruim', 80, 30, 28],
    [t1, 75.4], // mesma data/hora: não duplica
  ];
  it('lê as medições, ordena e deduplica', () => {
    const r = parseBodyRows(rows);
    expect(r.readings.map((x) => x.time)).toEqual(['2026-03-05T13:52:00', '2026-11-12T07:15:00']);
    expect(r.skipped).toBe(1); // só "data ruim"
    const last = r.readings[1];
    expect(last).toMatchObject({ weightKg: 75.4, bmi: 25.3, fatPct: 21.5, skeletalMuscleKg: 28.9, waterPct: 55, visceralFat: 8, bmrKcal: 1600 });
    expect(r.readings[0]).toMatchObject({ weightKg: 76.1, fatPct: 22 }); // vírgula decimal
    expect(r.columns).toContain('weightKg');
  });
  it('falha com mensagem clara se não achar data e peso', () => {
    expect(() => parseBodyRows([['A', 'B'], [1, 2]])).toThrow(/data e de peso/);
  });
});

describe('comparações', () => {
  const mk = (time: string, w: number, fat?: number) => ({ key: time, time, weightKg: w, fatPct: fat });
  it('metricDelta usa a última e a anterior que têm a métrica', () => {
    const rs = [mk('2026-03-01T08:00:00', 70, 20), mk('2026-04-10T08:00:00', 72.5, 21), mk('2026-05-20T08:00:00', 71.7)];
    expect(metricDelta(rs, 'weightKg')).toEqual({ latest: 71.7, delta: -0.8 });
    expect(metricDelta(rs, 'fatPct')).toEqual({ latest: 21, delta: 1 });
    expect(metricDelta(rs, 'bmrKcal')).toBeNull();
    expect(metricDelta([mk('2026-01-01T08:00:00', 80)], 'weightKg')).toEqual({ latest: 80, delta: null });
  });
  it('mergeBody não duplica', () => {
    const a = [mk('2026-07-01T08:00:00', 70)];
    const m = mergeBody(a, [mk('2026-07-01T08:00:00', 70.1), mk('2026-08-01T08:00:00', 71)]);
    expect(m.added).toBe(1);
    expect(m.all.map((x) => x.weightKg)).toEqual([70.1, 71]);
  });
  it('IMC pela OMS', () => {
    expect(bmiClass(18.4).label).toBe('Abaixo do peso');
    expect(bmiClass(22).label).toBe('Peso normal');
    expect(bmiClass(27).label).toBe('Sobrepeso');
    expect(bmiClass(31)).toEqual({ label: 'Obesidade', tone: 'high' });
  });
});
