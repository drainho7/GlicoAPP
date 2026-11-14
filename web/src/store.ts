import { DEFAULT_SETTINGS, normalizeTime, Reading, Settings } from '../../src/analytics/analytics';
import { BodyReading, mergeBody } from '../../src/body/body';

export interface StoredReading extends Reading {
  baseTime: string;
  offsetMinutes?: number;
}

const RK = 'glico.web.readings.v1';
const SK = 'glico.web.settings.v1';

// Só há um medidor em uso (CareTech); a chave de dedup é medidor|sequência|horário base,
// igual para o arquivo do script Python e para o Web Bluetooth.
export const METER_ID = 'caretech';
export const makeKey = (sequence: number, baseTime: string) => `${METER_ID}|${sequence}|${baseTime}`;

const BK = 'glico.web.body.v1';

/** Cópia de segurança em Documentos\Glico\backup.json (só no app de Windows). */
function backup() {
  try {
    void window.glico?.backupSave(
      JSON.stringify({ version: 2, readings: loadReadings(), body: loadBody(), settings: loadSettings() }),
    );
  } catch {
    /* backup é best-effort */
  }
}

/** Ao abrir o app: garante que já existe cópia de segurança dos dados atuais (ex.: vindos da versão anterior). */
export function ensureBackup() {
  if (window.glico && (loadReadings().length || loadBody().length)) backup();
}

/** Se o armazenamento local estiver vazio (reinstalação, perfil apagado), restaura do backup. */
export async function restoreFromBackup(): Promise<boolean> {
  if (!window.glico) return false;
  const needGlucose = loadReadings().length === 0;
  const needBody = loadBody().length === 0;
  if (!needGlucose && !needBody) return false;
  try {
    const txt = await window.glico.backupLoad();
    if (!txt) return false;
    const b = JSON.parse(txt) as { readings?: StoredReading[]; body?: BodyReading[]; settings?: Settings };
    let restored = false;
    if (needGlucose && Array.isArray(b.readings) && b.readings.length) {
      localStorage.setItem(RK, JSON.stringify(b.readings));
      if (b.settings) localStorage.setItem(SK, JSON.stringify(b.settings));
      restored = true;
    }
    if (needBody && Array.isArray(b.body) && b.body.length) {
      localStorage.setItem(BK, JSON.stringify(b.body));
      restored = true;
    }
    return restored;
  } catch {
    return false;
  }
}

/* ---------------- Bioimpedância ---------------- */

export function loadBody(): BodyReading[] {
  try {
    return JSON.parse(localStorage.getItem(BK) ?? '[]');
  } catch {
    return [];
  }
}

export function addBody(incoming: BodyReading[]): { added: number; all: BodyReading[] } {
  const m = mergeBody(loadBody(), incoming);
  localStorage.setItem(BK, JSON.stringify(m.all));
  backup();
  return m;
}

export function loadReadings(): StoredReading[] {
  try {
    return JSON.parse(localStorage.getItem(RK) ?? '[]');
  } catch {
    return [];
  }
}

export function mergeReadings(incoming: StoredReading[]): { added: number; all: StoredReading[] } {
  const map = new Map(loadReadings().map((r) => [r.key, r]));
  let added = 0;
  for (const r of incoming) {
    if (!map.has(r.key)) added++;
    map.set(r.key, r);
  }
  const all = [...map.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
  localStorage.setItem(RK, JSON.stringify(all));
  backup();
  return { added, all };
}

export function clearReadings() {
  localStorage.removeItem(RK);
  localStorage.removeItem(BK);
  backup(); // o backup também fica vazio: apagar é apagar de verdade
}

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SK) ?? 'null');
    if (!s) return DEFAULT_SETTINGS;
    // Migração: a janela de janta antiga (19:30–23:00), nunca personalizada, passa para o novo padrão (até 01:00).
    const j = s.windows?.janta;
    if (Array.isArray(j) && j[0] === 19 * 60 + 30 && j[1] === 23 * 60) s.windows.janta = DEFAULT_SETTINGS.windows.janta;
    // Migração: meta de jejum antiga (70–130), nunca personalizada, passa para a da SBD (80–130).
    const t = s.targets?.jejum;
    if (Array.isArray(t) && t[0] === 70 && t[1] === 130) s.targets.jejum = DEFAULT_SETTINGS.targets.jejum;
    return { ...DEFAULT_SETTINGS, ...s };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export const saveSettings = (s: Settings) => {
  localStorage.setItem(SK, JSON.stringify(s));
  backup();
};

/** Converte o data/readings.json gerado por tools/ble_diag.py. */
export function fromScriptJson(text: string): StoredReading[] {
  const rows = JSON.parse(text) as Array<{
    sequence: number;
    baseTime: string;
    offsetMinutes?: number;
    adjustedTime: string;
    mgdl: number;
  }>;
  return rows
    .filter((r) => typeof r.mgdl === 'number')
    .map((r) => {
      const baseTime = normalizeTime(r.baseTime);
      return {
        key: makeKey(r.sequence, baseTime),
        time: normalizeTime(r.adjustedTime),
        mgdl: r.mgdl,
        sequence: r.sequence,
        baseTime,
        offsetMinutes: r.offsetMinutes,
      };
    });
}
