/**
 * Bioimpedância: modelo, leitor da planilha exportada pelo app da balança (OKOK) e comparações.
 * Tudo em horário "ingênuo" local ("YYYY-MM-DDTHH:mm:ss"), como na glicemia.
 */

export type BodyMetricKey =
  | 'weightKg'
  | 'bmi'
  | 'fatPct'
  | 'fatKg'
  | 'skeletalMusclePct'
  | 'skeletalMuscleKg'
  | 'musclePct'
  | 'muscleKg'
  | 'waterPct'
  | 'waterKg'
  | 'visceralFat'
  | 'bmrKcal'
  | 'heightCm'
  | 'age';

export interface BodyReading {
  /** Chave de deduplicação: origem + data/hora até o minuto. */
  key: string;
  time: string;
  weightKg: number;
  bmi?: number;
  fatPct?: number;
  fatKg?: number;
  skeletalMusclePct?: number;
  skeletalMuscleKg?: number;
  musclePct?: number;
  muscleKg?: number;
  waterPct?: number;
  waterKg?: number;
  visceralFat?: number;
  bmrKcal?: number;
  heightCm?: number;
  age?: number;
}

export interface MetricDef {
  key: BodyMetricKey;
  label: string;
  unit: string;
  decimals: number;
}

/** Métricas exibidas (altura e idade são só contexto). */
export const BODY_METRICS: MetricDef[] = [
  { key: 'weightKg', label: 'Peso', unit: 'kg', decimals: 2 },
  { key: 'bmi', label: 'IMC', unit: '', decimals: 1 },
  { key: 'fatPct', label: 'Gordura', unit: '%', decimals: 1 },
  { key: 'fatKg', label: 'Peso da gordura', unit: 'kg', decimals: 1 },
  { key: 'skeletalMusclePct', label: 'Músculo esquelético', unit: '%', decimals: 1 },
  { key: 'skeletalMuscleKg', label: 'Peso do músculo esquelético', unit: 'kg', decimals: 1 },
  { key: 'musclePct', label: 'Massa muscular', unit: '%', decimals: 1 },
  { key: 'muscleKg', label: 'Peso da massa muscular', unit: 'kg', decimals: 1 },
  { key: 'waterPct', label: 'Água', unit: '%', decimals: 1 },
  { key: 'waterKg', label: 'Peso da água', unit: 'kg', decimals: 1 },
  { key: 'visceralFat', label: 'Gordura visceral', unit: '', decimals: 1 },
  { key: 'bmrKcal', label: 'Metabolismo basal', unit: 'kcal/dia', decimals: 0 },
];

/* ---------------- Leitura da planilha ---------------- */

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]/g, '');

type Field = BodyMetricKey | 'time';

/** Reconhece a coluna pelo nome (português do app OKOK e alguns nomes em inglês). */
export function fieldFor(header: unknown): Field | null {
  const h = norm(header);
  if (!h) return null;
  if (/^(tempo|data|hora|datahora|date|time|datetime|datadamedicao|datadapesagem)/.test(h)) return 'time';
  if (h.includes('visceral')) return 'visceralFat';
  if (h.includes('imc') || h.includes('bmi')) return 'bmi';
  if (h.includes('metabol') || h.includes('bmr') || h.includes('kcal')) return 'bmrKcal';
  if (h.includes('altura') || h.includes('height')) return 'heightCm';
  if (h.includes('idade') || h === 'age') return 'age';
  const kg = h.includes('kg') || h.startsWith('pesoda');
  if (h.includes('esqueletica') || h.includes('skeletal')) return kg ? 'skeletalMuscleKg' : 'skeletalMusclePct';
  if (h.includes('gordura') || h.includes('fat')) return kg ? 'fatKg' : 'fatPct';
  if (h.includes('agua') || h.includes('water')) return kg ? 'waterKg' : 'waterPct';
  if (h.includes('musc')) return kg ? 'muscleKg' : 'musclePct';
  if (h === 'peso' || h === 'pesokg' || h === 'weight' || h === 'weightkg') return 'weightKg';
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const iso = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;

/** Aceita Date do Excel (lido como UTC, sem fuso), número serial, ISO e dd/mm/aaaa [hh:mm[:ss]]. */
export function parseCellTime(v: unknown): string | null {
  // O Excel guarda a hora como fração do dia: 11:50 vira 11:49:59,999 na conversão. Arredonda ao segundo.
  const toIso = (ms: number) => {
    const d = new Date(Math.round(ms / 1000) * 1000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  };
  if (v instanceof Date && !Number.isNaN(v.getTime())) return toIso(v.getTime());
  if (typeof v === 'number' && v > 20000 && v < 80000) return toIso(Date.UTC(1899, 11, 30) + v * 86_400_000);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    let d = +m[1];
    let mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // formato mês/dia só quando o 2º número não pode ser mês
    if (mo > 12 || d > 31) return null;
    return iso(+m[3], mo, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  return null;
}

const toNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(',', '.').replace(/[^0-9.+-]/g, '');
  if (!t || t === '-' || t === '--') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

export interface ParsedBody {
  readings: BodyReading[];
  /** Linhas ignoradas (sem data ou sem peso). */
  skipped: number;
  /** Colunas reconhecidas, para conferência na tela. */
  columns: string[];
}

export function parseBodyRows(rows: unknown[][], source = 'okok'): ParsedBody {
  let headerIdx = -1;
  let map: (Field | null)[] = [];
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const m = (rows[i] ?? []).map(fieldFor);
    if (m.includes('time') && m.includes('weightKg')) {
      headerIdx = i;
      map = m;
      break;
    }
  }
  if (headerIdx < 0) throw new Error('Não encontrei as colunas de data e de peso. Confira se é o arquivo exportado pelo app da balança.');

  const out = new Map<string, BodyReading>();
  let skipped = 0;
  for (const row of rows.slice(headerIdx + 1)) {
    if (!row || row.every((c) => c === null || c === undefined || c === '')) continue;
    const rec: Partial<Record<BodyMetricKey, number>> = {};
    let time: string | null = null;
    map.forEach((f, i) => {
      if (!f) return;
      if (f === 'time') time = parseCellTime(row[i]);
      else {
        const n = toNumber(row[i]);
        if (n !== undefined) rec[f] = n;
      }
    });
    if (!time || rec.weightKg === undefined || rec.weightKg <= 0) {
      skipped++;
      continue;
    }
    const key = `${source}|${(time as string).slice(0, 16)}`;
    // Linhas repetidas para o mesmo minuto são combinadas: campos novos completam os antigos, sem apagá-los.
    out.set(key, { ...out.get(key), ...rec, weightKg: rec.weightKg, key, time: time as string });
  }
  const readings = [...out.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
  return { readings, skipped, columns: [...new Set(map.filter((f): f is Field => !!f))] };
}

/* ---------------- Comparações ---------------- */

/** Une duas listas sem duplicar (a nova substitui a antiga de mesma chave) e ordena por data. */
export function mergeBody(existing: BodyReading[], incoming: BodyReading[]): { all: BodyReading[]; added: number } {
  const map = new Map(existing.map((r) => [r.key, r]));
  let added = 0;
  for (const r of incoming) {
    if (!map.has(r.key)) added++;
    map.set(r.key, r);
  }
  return { all: [...map.values()].sort((a, b) => (a.time < b.time ? -1 : 1)), added };
}

/** Diferença entre a última medição que tem a métrica e a anterior que também tem. */
export function metricDelta(readings: BodyReading[], key: BodyMetricKey): { latest: number; delta: number | null } | null {
  const withKey = readings.filter((r) => typeof r[key] === 'number');
  if (!withKey.length) return null;
  const latest = withKey[withKey.length - 1][key] as number;
  const prev = withKey.length > 1 ? (withKey[withKey.length - 2][key] as number) : null;
  return { latest, delta: prev === null ? null : Math.round((latest - prev) * 100) / 100 };
}

/** Idade em anos completos numa data ("YYYY-MM-DD..."), a partir do nascimento. null se as datas forem inválidas. */
export function ageAt(birth: string | undefined, onDate: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(birth ?? '');
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(onDate);
  if (!b || !d) return null;
  let age = +d[1] - +b[1];
  if (+d[2] < +b[2] || (+d[2] === +b[2] && +d[3] < +b[3])) age--;
  return age >= 0 && age < 130 ? age : null;
}

export type BmiClass = { label: string; tone: 'ok' | 'high' | 'low' };

/** Classificação do IMC em adultos (OMS). */
export function bmiClass(bmi: number): BmiClass {
  if (bmi < 18.5) return { label: 'Abaixo do peso', tone: 'low' };
  if (bmi < 25) return { label: 'Peso normal', tone: 'ok' };
  if (bmi < 30) return { label: 'Sobrepeso', tone: 'high' };
  return { label: 'Obesidade', tone: 'high' };
}
