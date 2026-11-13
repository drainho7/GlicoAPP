import {
  addMinutesNaive,
  decodeSfloat,
  dedupKey,
  parseGlucoseContext,
  parseGlucoseMeasurement,
  parseRacpIndication,
  RACP_REPORT_ALL,
  RACP_REPORT_ALL_B64,
} from '../glucoseParser';
import { normalizeUuid, shortLabel, shortToUuid } from '../uuids';

const b = (...x: number[]) => new Uint8Array(x);

describe('uuids', () => {
  it('converte UUID curto para 128 bits', () => {
    expect(shortToUuid(0x1808)).toBe('00001808-0000-1000-8000-00805f9b34fb');
    expect(shortToUuid('0x2A52')).toBe('00002a52-0000-1000-8000-00805f9b34fb');
  });
  it('normaliza e abrevia', () => {
    expect(normalizeUuid('2A18')).toBe('00002a18-0000-1000-8000-00805f9b34fb');
    expect(shortLabel('00002A18-0000-1000-8000-00805F9B34FB')).toBe('2A18');
    expect(shortLabel('11111111-2222-3333-4444-555555555555')).toBe('11111111-2222-3333-4444-555555555555');
  });
});

describe('SFLOAT', () => {
  it('decodifica valores normais', () => {
    expect(decodeSfloat(0xb05f)).toEqual({ kind: 'value', value: 95e-5 });
    expect(decodeSfloat(0x0064)).toEqual({ kind: 'value', value: 100 });
  });
  it('decodifica mantissa negativa', () => {
    expect(decodeSfloat(0x0fff)).toEqual({ kind: 'value', value: -1 });
  });
  it('não converte valores especiais em números', () => {
    expect(decodeSfloat(0x07ff)).toEqual({ kind: 'special', special: 'NaN' });
    expect(decodeSfloat(0x0800)).toEqual({ kind: 'special', special: 'NRes' });
    expect(decodeSfloat(0x07fe)).toEqual({ kind: 'special', special: '+INF' });
    expect(decodeSfloat(0x0802)).toEqual({ kind: 'special', special: '-INF' });
  });
});

describe('Glucose Measurement', () => {
  // flags=0x02 (concentração, kg/L), seq=5, 2024-03-10 07:30:00, 95e-5 kg/L, tipo 1 / local 1
  const basic = b(0x02, 0x05, 0x00, 0xe8, 0x07, 0x03, 0x0a, 0x07, 0x1e, 0x00, 0x5f, 0xb0, 0x11);

  it('lê pacote básico em kg/L e converte para mg/dL', () => {
    const m = parseGlucoseMeasurement(basic);
    expect(m.sequence).toBe(5);
    expect(m.baseTime).toBe('2024-03-10T07:30:00');
    expect(m.adjustedTime).toBe('2024-03-10T07:30:00');
    expect(m.mgdl).toBe(95);
    expect(m.rawUnit).toBe('kg/L');
    expect(m.typeCode).toBe(1);
    expect(m.sampleLocationCode).toBe(1);
    expect(m.timeOffsetMinutes).toBeUndefined();
    expect(m.contextFollows).toBe(false);
  });

  it('aplica Time Offset negativo cruzando a meia-noite sem tratar como UTC', () => {
    // flags=0x03, offset=-120 min, 2024-03-01 01:00:00
    const m = parseGlucoseMeasurement(
      b(0x03, 0x07, 0x00, 0xe8, 0x07, 0x03, 0x01, 0x01, 0x00, 0x00, 0x88, 0xff, 0x5f, 0xb0, 0x11),
    );
    expect(m.timeOffsetMinutes).toBe(-120);
    expect(m.baseTime).toBe('2024-03-01T01:00:00');
    expect(m.adjustedTime).toBe('2024-02-29T23:00:00'); // 2024 é bissexto
    expect(m.mgdl).toBe(95);
  });

  it('converte mol/L para mg/dL (~18015,6)', () => {
    // flags=0x06 (concentração + mol/L), 5,5 mmol/L = 55e-4 mol/L -> 0xC037
    const m = parseGlucoseMeasurement(
      b(0x06, 0x01, 0x00, 0xe8, 0x07, 0x01, 0x02, 0x08, 0x00, 0x00, 0x37, 0xc0, 0x11),
    );
    expect(m.rawUnit).toBe('mol/L');
    expect(m.mgdl).toBeCloseTo(99.09, 2);
  });

  it('marca contexto seguinte e lê status do sensor', () => {
    // flags=0x1A: conc + status + contexto
    const m = parseGlucoseMeasurement(
      b(0x1a, 0x09, 0x00, 0xe8, 0x07, 0x05, 0x14, 0x0c, 0x00, 0x00, 0x5f, 0xb0, 0x11, 0x04, 0x00),
    );
    expect(m.contextFollows).toBe(true);
    expect(m.sensorStatus).toBe(4);
    expect(m.mgdl).toBe(95);
  });

  it('NaN e NRes não viram leitura numérica', () => {
    const nan = parseGlucoseMeasurement(
      b(0x02, 0x01, 0x00, 0xe8, 0x07, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff, 0x07, 0x11),
    );
    expect(nan.mgdl).toBeUndefined();
    expect(nan.specialValue).toBe('NaN');
    const nres = parseGlucoseMeasurement(
      b(0x02, 0x01, 0x00, 0xe8, 0x07, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x08, 0x11),
    );
    expect(nres.mgdl).toBeUndefined();
    expect(nres.specialValue).toBe('NRes');
  });

  it('rejeita pacote truncado ou data inválida', () => {
    expect(() => parseGlucoseMeasurement(b(0x02, 0x01, 0x00))).toThrow(/truncado/);
    expect(() => parseGlucoseMeasurement(basic.slice(0, 12))).toThrow(/truncado/);
    expect(() =>
      parseGlucoseMeasurement(b(0x00, 0x01, 0x00, 0xe8, 0x07, 0x0d, 0x01, 0x00, 0x00, 0x00)),
    ).toThrow(/inválida/);
  });
});

describe('Glucose Measurement Context', () => {
  it('lê refeição (jejum)', () => {
    const c = parseGlucoseContext(b(0x02, 0x05, 0x00, 0x03));
    expect(c).toEqual({ sequence: 5, meal: 3 });
  });
  it('lê carboidratos e refeição', () => {
    // flags=0x03, seq=5, carbId=1, 0,05 kg (0xE005) = 50 g, meal=2 (pós-prandial)
    const c = parseGlucoseContext(b(0x03, 0x05, 0x00, 0x01, 0x05, 0xe0, 0x02));
    expect(c.carbohydrateId).toBe(1);
    expect(c.carbohydrateGrams).toBeCloseTo(50, 5);
    expect(c.meal).toBe(2);
  });
  it('rejeita truncado', () => {
    expect(() => parseGlucoseContext(b(0x02, 0x05, 0x00))).toThrow(/truncado/);
  });
});

describe('RACP', () => {
  it('comando Report All = 01 01 = "AQE="', () => {
    expect(Array.from(RACP_REPORT_ALL)).toEqual([0x01, 0x01]);
    expect(Buffer.from(RACP_REPORT_ALL).toString('base64')).toBe(RACP_REPORT_ALL_B64);
  });
  it('sucesso', () => {
    expect(parseRacpIndication(b(0x06, 0x00, 0x01, 0x01))).toMatchObject({ type: 'response', result: 'success' });
  });
  it('sem registros', () => {
    expect(parseRacpIndication(b(0x06, 0x00, 0x01, 0x06))).toMatchObject({ result: 'no_records_found' });
  });
  it('erros', () => {
    expect(parseRacpIndication(b(0x06, 0x00, 0x01, 0x02))).toMatchObject({ result: 'opcode_not_supported' });
    expect(parseRacpIndication(b(0x06, 0x00, 0x01, 0x08))).toMatchObject({ result: 'procedure_not_completed' });
    expect(parseRacpIndication(b(0x06, 0x00, 0x01, 0x63))).toMatchObject({ result: 'unknown', resultCode: 0x63 });
  });
  it('contagem de registros', () => {
    expect(parseRacpIndication(b(0x05, 0x00, 0x0a, 0x00))).toEqual({ type: 'count', count: 10 });
  });
  it('rejeita opcode inesperado e truncado', () => {
    expect(() => parseRacpIndication(b(0x09, 0x00))).toThrow();
    expect(() => parseRacpIndication(b(0x06, 0x00, 0x01))).toThrow(/truncado/);
  });
});

describe('utilidades', () => {
  it('addMinutesNaive', () => {
    expect(addMinutesNaive('2024-12-31T23:30:00', 45)).toBe('2025-01-01T00:15:00');
    expect(addMinutesNaive('2024-03-10T07:30:00', 0)).toBe('2024-03-10T07:30:00');
  });
  it('dedupKey inclui medidor, sequência e horário base', () => {
    expect(dedupKey('AA:BB', { sequence: 5, baseTime: '2024-03-10T07:30:00' })).toBe('AA:BB|5|2024-03-10T07:30:00');
  });
});
