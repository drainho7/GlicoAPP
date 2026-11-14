import { ageAt } from '../body';
import { bmiOf, bmiZone, fatZone, idealWeightRange, muscleZone, visceralZone, waterZone, weightZone, ZONE_SCALE } from '../zones';

describe('gordura corporal % (Omron)', () => {
  it('homens: limites 10 / 20 / 25', () => {
    expect(fatZone(9.9, 'M')?.level).toBe('below');
    expect(fatZone(10, 'M')?.level).toBe('ideal');
    expect(fatZone(19.9, 'M')?.level).toBe('ideal');
    expect(fatZone(20, 'M')?.level).toBe('l1');
    expect(fatZone(24.9, 'M')?.label).toBe('Gordura alta');
    expect(fatZone(25, 'M')).toMatchObject({ level: 'l2', label: 'Gordura muito alta', arrow: '▲' });
    expect(fatZone(28, 'M')?.level).toBe('l2');
  });
  it('mulheres: limites 20 / 30 / 35', () => {
    expect(fatZone(19.9, 'F')?.level).toBe('below');
    expect(fatZone(25, 'F')?.level).toBe('ideal');
    expect(fatZone(30, 'F')?.level).toBe('l1');
    expect(fatZone(35, 'F')?.level).toBe('l2');
  });
  it('mostra a faixa normal usada', () => {
    expect(fatZone(15, 'M')?.note).toBe('Normal: 10,0–19,9% (homens)');
    expect(fatZone(25, 'F')?.note).toBe('Normal: 20,0–29,9% (mulheres)');
  });
  it('fora de 18–80 anos não classifica (limite do fabricante)', () => {
    expect(fatZone(25, 'M', 17)).toBeNull();
    expect(fatZone(25, 'M', 81)).toBeNull();
    expect(fatZone(25, 'M', 40)).not.toBeNull();
  });
});

describe('gordura visceral (Omron)', () => {
  it('1–9 normal, 10–14 alta, 15+ muito alta', () => {
    expect(visceralZone(9)?.level).toBe('ideal');
    expect(visceralZone(10)?.level).toBe('l1');
    expect(visceralZone(14.9)?.level).toBe('l1');
    expect(visceralZone(15)?.level).toBe('l2');
    expect(visceralZone(16)).toMatchObject({ label: 'Visceral muito alta', arrow: '▲' });
  });
});

describe('água corporal %', () => {
  it('homens 50–65, mulheres 45–60', () => {
    expect(waterZone(53, 'M').level).toBe('ideal');
    expect(waterZone(49.9, 'M')).toMatchObject({ level: 'below', arrow: '▼' });
    expect(waterZone(65.1, 'M').level).toBe('l1');
    expect(waterZone(44, 'F').level).toBe('below');
    expect(waterZone(60, 'F').level).toBe('ideal');
  });
});

describe('músculo esquelético % (homens, Omron)', () => {
  it('baixo / normal / alto / muito alto; mais músculo continua azul', () => {
    expect(muscleZone(32.8, 'M')).toMatchObject({ level: 'below', arrow: '▼' });
    expect(muscleZone(34, 'M')).toMatchObject({ level: 'ideal', arrow: '●' });
    expect(muscleZone(36, 'M')).toMatchObject({ level: 'ideal', arrow: '▲', label: 'Músculo alto' });
    expect(muscleZone(38, 'M')).toMatchObject({ level: 'ideal', arrow: '▲', label: 'Músculo muito alto' });
  });
  it('mulheres: sem classificação (tabela do fabricante com erros)', () => {
    expect(muscleZone(30, 'F')).toBeNull();
  });
});

describe('ageAt', () => {
  it('idade em anos completos', () => {
    expect(ageAt('1990-03-15', '2026-11-14')).toBe(36);
    expect(ageAt('1990-03-15', '2026-03-14')).toBe(35);
    expect(ageAt('1990-03-15', '2026-03-15')).toBe(36);
    expect(ageAt('1990-03-15', '2026-11-14T08:05:00')).toBe(36);
  });
  it('datas inválidas ou futuras', () => {
    expect(ageAt(undefined, '2026-11-14')).toBeNull();
    expect(ageAt('lixo', '2026-11-14')).toBeNull();
    expect(ageAt('2030-01-01', '2026-11-14')).toBeNull();
  });
});

describe('bmiZone (OMS / Ministério da Saúde, adultos)', () => {
  it('limites das faixas e graus', () => {
    expect(bmiZone(18.4)?.level).toBe('below');
    expect(bmiZone(18.5)?.level).toBe('ideal');
    expect(bmiZone(24.9)?.level).toBe('ideal');
    expect(bmiZone(25)?.level).toBe('l1');
    expect(bmiZone(29.9)?.label).toBe('Sobrepeso');
    expect(bmiZone(30)).toEqual({ level: 'l2', label: 'Obesidade grau I', arrow: '▲' });
    expect(bmiZone(35)?.label).toBe('Obesidade grau II');
    expect(bmiZone(40)).toEqual({ level: 'l4', label: 'Obesidade grau III', arrow: '▲' });
  });
  it('setas: ▼ abaixo, ● ideal, ▲ acima', () => {
    expect(bmiZone(17)?.arrow).toBe('▼');
    expect(bmiZone(22)?.arrow).toBe('●');
    expect(bmiZone(31)?.arrow).toBe('▲');
  });
  it('60 anos ou mais: sem classificação (outros cortes)', () => {
    expect(bmiZone(30, 60)).toBeNull();
    expect(bmiZone(30, 59)?.level).toBe('l2');
  });
});

describe('peso pela altura', () => {
  it('faixa ideal para 180 cm: IMC 18,5 a 24,9 aplicado à altura', () => {
    expect(idealWeightRange(180)).toEqual([59.94, 80.68]);
  });
  it('peso e altura de exemplo: sobrepeso e obesidade grau I', () => {
    expect(bmiOf(95, 180)).toBeCloseTo(29.32, 2);
    expect(weightZone(95, 180)).toMatchObject({ level: 'l1', label: 'Sobrepeso', ideal: [59.94, 80.68] });
    expect(weightZone(105, 180)).toMatchObject({ level: 'l2', label: 'Obesidade grau I' });
  });
  it('sem altura (ou altura absurda) não classifica', () => {
    expect(weightZone(80, undefined)).toBeNull();
    expect(weightZone(80, 20)).toBeNull();
  });
  it('a escala tem 6 níveis, do ciano ao magenta', () => {
    expect(ZONE_SCALE.map((z) => z.level)).toEqual(['below', 'ideal', 'l1', 'l2', 'l3', 'l4']);
  });
});
