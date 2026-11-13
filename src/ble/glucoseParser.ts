/**
 * Parser do Bluetooth Glucose Service 1.0.1 (puro, sem dependências nativas).
 * Todos os campos multi-byte são little-endian.
 */

export type SfloatResult =
  | { kind: 'value'; value: number }
  | { kind: 'special'; special: 'NaN' | 'NRes' | '+INF' | '-INF' | 'Reserved' };

/** Decodifica IEEE 11073-20601 SFLOAT de 16 bits (mantissa 12 bits, expoente 4 bits, ambos com sinal). */
export function decodeSfloat(raw: number): SfloatResult {
  raw &= 0xffff;
  switch (raw) {
    case 0x07ff:
      return { kind: 'special', special: 'NaN' };
    case 0x0800:
      return { kind: 'special', special: 'NRes' };
    case 0x07fe:
      return { kind: 'special', special: '+INF' };
    case 0x0802:
      return { kind: 'special', special: '-INF' };
    case 0x0801:
      return { kind: 'special', special: 'Reserved' };
  }
  let mantissa = raw & 0x0fff;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  let exponent = raw >> 12;
  if (exponent >= 0x08) exponent -= 0x10;
  // Dividir por 10^|e| evita o ruído de mantissa * 10^-e (ex.: 95 * 1e-5 = 0.0009500000000000001).
  const value = exponent >= 0 ? mantissa * Math.pow(10, exponent) : mantissa / Math.pow(10, -exponent);
  return { kind: 'value', value };
}

export const KG_L_TO_MG_DL = 100_000;
export const MOL_L_TO_MG_DL = 18_015.6;

export interface GlucoseMeasurement {
  sequence: number;
  /** Horário base do medidor, sem fuso: "YYYY-MM-DDTHH:mm:ss". Nunca assumido como UTC. */
  baseTime: string;
  /** Time Offset em minutos, se presente. */
  timeOffsetMinutes?: number;
  /** baseTime + timeOffset (ainda sem fuso). Igual a baseTime quando não há offset. */
  adjustedTime: string;
  /** Concentração em mg/dL; ausente se o medidor enviou valor especial ou não enviou. */
  mgdl?: number;
  /** Valor bruto na unidade do pacote. */
  rawValue?: number;
  rawUnit?: 'kg/L' | 'mol/L';
  specialValue?: 'NaN' | 'NRes' | '+INF' | '-INF' | 'Reserved';
  typeCode?: number;
  sampleLocationCode?: number;
  sensorStatus?: number;
  contextFollows: boolean;
}

export interface GlucoseContext {
  sequence: number;
  carbohydrateId?: number;
  carbohydrateGrams?: number;
  /** 1 pré-prandial, 2 pós-prandial, 3 jejum, 4 casual, 5 hora de dormir */
  meal?: number;
  testerCode?: number;
  healthCode?: number;
  exerciseDurationSeconds?: number;
  exerciseIntensityPercent?: number;
  medicationId?: number;
  medicationAmount?: number;
  hba1c?: number;
}

class Reader {
  private pos = 0;
  constructor(private readonly b: Uint8Array) {}
  get remaining() {
    return this.b.length - this.pos;
  }
  need(n: number, what: string) {
    if (this.remaining < n) throw new Error(`Pacote truncado ao ler ${what}`);
  }
  u8(what: string) {
    this.need(1, what);
    return this.b[this.pos++];
  }
  u16(what: string) {
    this.need(2, what);
    const v = this.b[this.pos] | (this.b[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  i16(what: string) {
    const v = this.u16(what);
    return v >= 0x8000 ? v - 0x10000 : v;
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function formatNaive(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Soma minutos a um horário sem fuso usando aritmética UTC apenas como calendário (sem conversão de fuso). */
export function addMinutesNaive(baseTime: string, minutes: number): string {
  if (!minutes) return baseTime;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(baseTime);
  if (!m) throw new Error(`baseTime inválido: ${baseTime}`);
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + minutes * 60_000;
  return formatNaive(new Date(t));
}

export function parseGlucoseMeasurement(bytes: Uint8Array): GlucoseMeasurement {
  const r = new Reader(bytes);
  const flags = r.u8('flags');
  const hasOffset = !!(flags & 0x01);
  const hasConcentration = !!(flags & 0x02);
  const molPerL = !!(flags & 0x04);
  const hasStatus = !!(flags & 0x08);
  const contextFollows = !!(flags & 0x10);

  const sequence = r.u16('sequence');
  const year = r.u16('year');
  const month = r.u8('month');
  const day = r.u8('day');
  const hour = r.u8('hour');
  const minute = r.u8('minute');
  const second = r.u8('second');
  if (year < 1582 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Data/hora inválida no pacote (${year}-${month}-${day} ${hour}:${minute}:${second})`);
  }
  const baseTime = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;

  const out: GlucoseMeasurement = { sequence, baseTime, adjustedTime: baseTime, contextFollows };

  if (hasOffset) {
    out.timeOffsetMinutes = r.i16('time offset');
    out.adjustedTime = addMinutesNaive(baseTime, out.timeOffsetMinutes);
  }

  if (hasConcentration) {
    const sf = decodeSfloat(r.u16('concentração'));
    const typeLoc = r.u8('tipo/local da amostra');
    out.typeCode = typeLoc & 0x0f;
    out.sampleLocationCode = typeLoc >> 4;
    out.rawUnit = molPerL ? 'mol/L' : 'kg/L';
    if (sf.kind === 'value') {
      out.rawValue = sf.value;
      const factor = molPerL ? MOL_L_TO_MG_DL : KG_L_TO_MG_DL;
      // Arredonda a 0,01 mg/dL para eliminar ruído de ponto flutuante (ex.: 95e-5 * 1e5).
      out.mgdl = Math.round(sf.value * factor * 100) / 100;
    } else {
      out.specialValue = sf.special;
    }
  }

  if (hasStatus) out.sensorStatus = r.u16('status do sensor');
  return out;
}

export function parseGlucoseContext(bytes: Uint8Array): GlucoseContext {
  const r = new Reader(bytes);
  const flags = r.u8('flags');
  const sequence = r.u16('sequence');
  const out: GlucoseContext = { sequence };

  if (flags & 0x80) r.u8('extended flags');
  if (flags & 0x01) {
    out.carbohydrateId = r.u8('carb id');
    const sf = decodeSfloat(r.u16('carboidratos'));
    if (sf.kind === 'value') out.carbohydrateGrams = sf.value * 1000; // kg -> g
  }
  if (flags & 0x02) out.meal = r.u8('refeição');
  if (flags & 0x04) {
    const v = r.u8('tester/saúde');
    out.testerCode = v & 0x0f;
    out.healthCode = v >> 4;
  }
  if (flags & 0x08) {
    const d = r.u16('duração exercício');
    out.exerciseDurationSeconds = d === 0xffff ? undefined : d;
    out.exerciseIntensityPercent = r.u8('intensidade exercício');
  }
  if (flags & 0x10) {
    out.medicationId = r.u8('id medicação');
    const sf = decodeSfloat(r.u16('medicação'));
    if (sf.kind === 'value') out.medicationAmount = sf.value;
  }
  if (flags & 0x40) {
    const sf = decodeSfloat(r.u16('HbA1c'));
    if (sf.kind === 'value') out.hba1c = sf.value;
  }
  return out;
}

/* ---------------- RACP (0x2A52) ---------------- */

export const RACP_REPORT_ALL = new Uint8Array([0x01, 0x01]); // Report stored records / All records
export const RACP_REPORT_ALL_B64 = 'AQE=';

export type RacpResult =
  | 'success'
  | 'opcode_not_supported'
  | 'invalid_operator'
  | 'operator_not_supported'
  | 'invalid_operand'
  | 'no_records_found'
  | 'abort_unsuccessful'
  | 'procedure_not_completed'
  | 'operand_not_supported'
  | 'unknown';

const RACP_RESULTS: Record<number, RacpResult> = {
  1: 'success',
  2: 'opcode_not_supported',
  3: 'invalid_operator',
  4: 'operator_not_supported',
  5: 'invalid_operand',
  6: 'no_records_found',
  7: 'abort_unsuccessful',
  8: 'procedure_not_completed',
  9: 'operand_not_supported',
};

export type RacpIndication =
  | { type: 'response'; requestOpcode: number; result: RacpResult; resultCode: number }
  | { type: 'count'; count: number };

export function parseRacpIndication(bytes: Uint8Array): RacpIndication {
  if (bytes.length < 2) throw new Error('Indicação RACP truncada');
  const opcode = bytes[0];
  if (opcode === 0x06) {
    if (bytes.length < 4) throw new Error('Response Code RACP truncado');
    return {
      type: 'response',
      requestOpcode: bytes[2],
      resultCode: bytes[3],
      result: RACP_RESULTS[bytes[3]] ?? 'unknown',
    };
  }
  if (opcode === 0x05) {
    if (bytes.length < 4) throw new Error('Number of Stored Records RACP truncado');
    return { type: 'count', count: bytes[2] | (bytes[3] << 8) };
  }
  throw new Error(`Opcode RACP inesperado: 0x${opcode.toString(16)}`);
}

/** Chave de deduplicação: medidor + sequência + horário base. */
export function dedupKey(deviceId: string, m: Pick<GlucoseMeasurement, 'sequence' | 'baseTime'>): string {
  return `${deviceId}|${m.sequence}|${m.baseTime}`;
}
