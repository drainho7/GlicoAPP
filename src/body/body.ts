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

/** 'date' = coluna só com a data; 'time' = hora (ou data e hora juntas, como no histórico do app). */
type Field = BodyMetricKey | 'time' | 'date';

/** Reconhece a coluna pelo nome (português do app OKOK e alguns nomes em inglês). */
export function fieldFor(header: unknown): Field | null {
  const h = norm(header);
  if (!h) return null;
  // Data e hora juntas, ou só a hora ("Tempo" na planilha exportada tem só HH:MM).
  if (/^(datahora|datetime|datadamedicao|datadapesagem|tempo|hora|time)/.test(h)) return 'time';
  // Só a data ("Data" na planilha exportada).
  if (/^(data|date)/.test(h)) return 'date';
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

/** Hora do dia "HH:MM[:SS]" (texto, Date do Excel só com hora, ou fração do dia). null se não for uma hora. */
export function parseClock(v: unknown): string | null {
  const fmt = (sec: number) => {
    const s = ((Math.round(sec) % 86400) + 86400) % 86400;
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  };
  if (typeof v === 'string') {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
    if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] ?? 0) > 59) return null;
    return `${pad(+m[1])}:${m[2]}:${pad(+(m[3] ?? 0))}`;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return fmt(v.getUTCHours() * 3600 + v.getUTCMinutes() * 60 + v.getUTCSeconds() + v.getUTCMilliseconds() / 1000);
  }
  if (typeof v === 'number' && v >= 0 && v < 1) return fmt(v * 86400);
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

/** Dados do cabeçalho da planilha ("Sexo：Masculino", "Idade：46Anos", "Altura：166cm"). Não guarda o nome. */
export interface BodyMeta {
  sex?: 'M' | 'F';
  age?: number;
  heightCm?: number;
}

export interface ParsedBody {
  readings: BodyReading[];
  /** Linhas ignoradas (sem data ou sem peso). */
  skipped: number;
  /** Colunas reconhecidas, para conferência na tela. */
  columns: string[];
  /** Sexo, idade e altura que o app da balança escreve acima da tabela, se houver. */
  meta: BodyMeta;
}

/** Procura sexo, idade e altura nas linhas acima da tabela (o app usa dois-pontos de largura total "："). */
export function parseMeta(rows: unknown[][]): BodyMeta {
  const meta: BodyMeta = {};
  for (const row of rows) {
    for (const cell of row ?? []) {
      if (typeof cell !== 'string') continue;
      const sex = /sexo\s*[:：]\s*(masculino|feminino)/i.exec(cell);
      if (sex) meta.sex = sex[1].toLowerCase() === 'masculino' ? 'M' : 'F';
      const age = /idade(?:\s+real)?\s*[:：]\s*(\d{1,3})/i.exec(cell);
      if (age && +age[1] >= 1 && +age[1] <= 120) meta.age = +age[1];
      const h = /altura\s*[:：]\s*(\d{2,3})\s*cm/i.exec(cell);
      if (h && +h[1] >= 100 && +h[1] <= 250) meta.heightCm = +h[1];
    }
  }
  return meta;
}

export function parseBodyRows(rows: unknown[][], source = 'okok'): ParsedBody {
  let headerIdx = -1;
  let map: (Field | null)[] = [];
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const m = (rows[i] ?? []).map(fieldFor);
    if ((m.includes('time') || m.includes('date')) && m.includes('weightKg')) {
      headerIdx = i;
      map = m;
      break;
    }
  }
  if (headerIdx < 0) throw new Error('Não encontrei as colunas de data e de peso. Confira se é o arquivo exportado pelo app da balança.');

  const meta = parseMeta(rows.slice(0, headerIdx));
  const out = new Map<string, BodyReading>();
  let skipped = 0;
  for (const row of rows.slice(headerIdx + 1)) {
    if (!row || row.every((c) => c === null || c === undefined || c === '')) continue;
    const rec: Partial<Record<BodyMetricKey, number>> = {};
    let dateCell: unknown;
    let timeCell: unknown;
    map.forEach((f, i) => {
      if (!f) return;
      if (f === 'time') timeCell = row[i];
      else if (f === 'date') dateCell = row[i];
      else {
        const n = toNumber(row[i]);
        if (n !== undefined) rec[f] = n;
      }
    });
    // A hora pode vir com a data junta (histórico do app) ou em coluna própria, ao lado da coluna "Data" (planilha exportada).
    let time: string | null = parseCellTime(timeCell);
    if (!time) {
      const day = parseCellTime(dateCell);
      const clock = parseClock(timeCell);
      if (day) time = clock ? `${day.slice(0, 10)}T${clock}` : day;
    }
    if (!time || rec.weightKg === undefined || rec.weightKg <= 0) {
      skipped++;
      continue;
    }
    const key = `${source}|${time.slice(0, 16)}`;
    // O sexo, a idade e a altura vêm uma vez só, no cabeçalho: valem para todas as linhas que não trouxerem a coluna.
    const base: Partial<BodyReading> = {};
    if (meta.heightCm !== undefined) base.heightCm = meta.heightCm;
    if (meta.age !== undefined) base.age = meta.age;
    // Linhas repetidas para o mesmo minuto são combinadas: campos novos completam os antigos, sem apagá-los.
    out.set(key, { ...base, ...out.get(key), ...rec, weightKg: rec.weightKg, key, time });
  }
  const readings = [...out.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
  return { readings, skipped, columns: [...new Set(map.filter((f): f is Field => !!f))], meta };
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
