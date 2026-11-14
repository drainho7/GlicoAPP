/**
 * Faixas e graus do peso/IMC. Base: classificação da OMS para adultos, adotada pelo Ministério da Saúde
 * (menores de 60 anos). Peso ideal = faixa de IMC 18,5–24,9 aplicada à altura.
 * Para 60 anos ou mais o Ministério usa outros cortes (Lipschitz); não implementados: retornam null.
 */

export type ZoneLevel = 'below' | 'ideal' | 'l1' | 'l2' | 'l3' | 'l4';

export interface Zone {
  level: ZoneLevel;
  label: string;
  /** Seta que indica a posição em relação à faixa ideal. */
  arrow: '▲' | '▼' | '●';
  /** Faixa usada na classificação, em texto, para o usuário conferir. */
  note?: string;
}

export type Sex = 'M' | 'F';

/** De onde vem cada referência (mostrado na tela). Só peso e IMC têm base oficial brasileira. */
export const ZONE_SOURCE = {
  weight: 'OMS / Ministério da Saúde',
  fat: 'Omron (fabricante, internacional)',
  visceral: 'Omron (fabricante, internacional)',
  muscle: 'Omron (fabricante, internacional)',
  water: 'faixas usuais de bioimpedância',
} as const;

/** Escala de cores (sem verde): ciano → azul → âmbar → laranja → vermelho → magenta. */
export const ZONE_SCALE: { level: ZoneLevel; label: string }[] = [
  { level: 'below', label: 'Abaixo do peso' },
  { level: 'ideal', label: 'Ideal' },
  { level: 'l1', label: 'Sobrepeso' },
  { level: 'l2', label: 'Obesidade grau I' },
  { level: 'l3', label: 'Obesidade grau II' },
  { level: 'l4', label: 'Obesidade grau III' },
];

export const BMI_IDEAL: [number, number] = [18.5, 24.9];

export function bmiZone(bmi: number, age?: number): Zone | null {
  if (age !== undefined && age >= 60) return null;
  if (bmi < 18.5) return { level: 'below', label: 'Abaixo do peso', arrow: '▼' };
  if (bmi < 25) return { level: 'ideal', label: 'Peso normal', arrow: '●' };
  if (bmi < 30) return { level: 'l1', label: 'Sobrepeso', arrow: '▲' };
  if (bmi < 35) return { level: 'l2', label: 'Obesidade grau I', arrow: '▲' };
  if (bmi < 40) return { level: 'l3', label: 'Obesidade grau II', arrow: '▲' };
  return { level: 'l4', label: 'Obesidade grau III', arrow: '▲' };
}

export const bmiOf = (weightKg: number, heightCm: number) => weightKg / (heightCm / 100) ** 2;

/** Faixa de peso ideal (kg) para a altura, pela faixa de IMC 18,5–24,9. */
export function idealWeightRange(heightCm: number): [number, number] {
  const h2 = (heightCm / 100) ** 2;
  return [Math.round(BMI_IDEAL[0] * h2 * 100) / 100, Math.round(BMI_IDEAL[1] * h2 * 100) / 100];
}

/* ---------------- Gordura, visceral, músculo e água ----------------
 * Sem tabela oficial brasileira. Fontes internacionais, conferidas no texto de cada uma:
 *  - Gordura %, músculo esquelético % e gordura visceral: tabelas da Omron (fabricante). Não são por idade,
 *    e o próprio fabricante só garante o uso entre 18 e 80 anos.
 *  - Água %: faixas usuais de tabelas de bioimpedância (homens 50–65%, mulheres 45–60%); as fontes divergem.
 *  - Músculo de mulheres: a tabela publicada tem erros de digitação, então não é classificado.
 */

const validAge = (age?: number) => age === undefined || (age >= 18 && age <= 80);
const c1 = (n: number) => n.toFixed(1).replace('.', ',');

/** Gordura corporal %. Homens: <10 baixa, 10–19,9 normal, 20–24,9 alta, ≥25 muito alta. Mulheres: 20 / 30 / 35. */
export function fatZone(fatPct: number, sex: Sex, age?: number): Zone | null {
  if (!validAge(age)) return null;
  const [lo, mid, hi] = sex === 'M' ? [10, 20, 25] : [20, 30, 35];
  const note = `Normal: ${c1(lo)}–${c1(mid - 0.1)}% (${sex === 'M' ? 'homens' : 'mulheres'})`;
  if (fatPct < lo) return { level: 'below', label: 'Gordura baixa', arrow: '▼', note };
  if (fatPct < mid) return { level: 'ideal', label: 'Gordura normal', arrow: '●', note };
  if (fatPct < hi) return { level: 'l1', label: 'Gordura alta', arrow: '▲', note };
  return { level: 'l2', label: 'Gordura muito alta', arrow: '▲', note };
}

/** Gordura visceral (índice do aparelho): 1–9 normal, 10–14 alta, 15+ muito alta. */
export function visceralZone(index: number, age?: number): Zone | null {
  if (!validAge(age)) return null;
  const note = 'Normal: 1–9 · alta: 10–14 · muito alta: 15 ou mais';
  if (index < 10) return { level: 'ideal', label: 'Visceral normal', arrow: '●', note };
  if (index < 15) return { level: 'l1', label: 'Visceral alta', arrow: '▲', note };
  return { level: 'l2', label: 'Visceral muito alta', arrow: '▲', note };
}

/** Água corporal %: homens 50–65, mulheres 45–60. */
export function waterZone(pct: number, sex: Sex): Zone {
  const [lo, hi] = sex === 'M' ? [50, 65] : [45, 60];
  const note = `Faixa usual: ${lo}–${hi}% (${sex === 'M' ? 'homens' : 'mulheres'})`;
  if (pct < lo) return { level: 'below', label: 'Água baixa', arrow: '▼', note };
  if (pct > hi) return { level: 'l1', label: 'Água alta', arrow: '▲', note };
  return { level: 'ideal', label: 'Água normal', arrow: '●', note };
}

/** Músculo esquelético % (só homens). Mais músculo não é ruim: acima do normal fica azul, com seta para cima. */
export function muscleZone(pct: number, sex: Sex, age?: number): Zone | null {
  if (sex !== 'M' || !validAge(age)) return null;
  const note = 'Normal: 32,9–35,8% (homens)';
  if (pct < 32.9) return { level: 'below', label: 'Músculo baixo', arrow: '▼', note };
  if (pct < 35.9) return { level: 'ideal', label: 'Músculo normal', arrow: '●', note };
  if (pct < 37.4) return { level: 'ideal', label: 'Músculo alto', arrow: '▲', note };
  return { level: 'ideal', label: 'Músculo muito alto', arrow: '▲', note };
}

/** Zona do peso, pela altura. null se faltar altura ou se tiver 60 anos ou mais. */
export function weightZone(weightKg: number, heightCm?: number, age?: number): (Zone & { ideal: [number, number] }) | null {
  if (!heightCm || heightCm < 100) return null;
  const z = bmiZone(bmiOf(weightKg, heightCm), age);
  return z ? { ...z, ideal: idealWeightRange(heightCm) } : null;
}
