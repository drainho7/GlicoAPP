import { Device, Subscription } from 'react-native-ble-plx';
import { StoredReading } from '../storage/readings';
import { b64ToBytes, bytesToB64, bytesToHex, isAuthError, probeProtectedRead } from './bleClient';
import {
  dedupKey,
  GlucoseContext,
  GlucoseMeasurement,
  parseGlucoseContext,
  parseGlucoseMeasurement,
  parseRacpIndication,
  RACP_REPORT_ALL,
  RacpResult,
} from './glucoseParser';
import { GLUCOSE_CONTEXT, GLUCOSE_MEASUREMENT, GLUCOSE_SERVICE, RACP } from './uuids';

export type SyncStatus =
  | 'success'
  | 'no_records'
  | 'racp_error'
  | 'timeout'
  | 'disconnected'
  | 'auth_required'
  | 'busy'
  | 'error';

export interface SyncOutcome {
  status: SyncStatus;
  racpResult?: RacpResult;
  message: string;
  readings: StoredReading[];
  skipped: number; // pacotes sem valor numérico (NaN/NRes) ou ilegíveis
  log: string[];
}

let syncing = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Importa o histórico completo via RACP "Report stored records / All records" (01 01 = "AQE=").
 * Somente leitura: nunca escreve em nada além do RACP e nunca envia "delete".
 */
export async function importHistory(
  device: Device,
  hasContext: boolean,
  opts: { timeoutMs?: number; onLog?: (line: string) => void } = {},
): Promise<SyncOutcome> {
  const log: string[] = [];
  const say = (s: string) => {
    log.push(s);
    opts.onLog?.(s);
  };
  const base = { readings: [] as StoredReading[], skipped: 0, log };

  if (syncing) return { ...base, status: 'busy', message: 'Já existe uma sincronização em andamento.' };
  syncing = true;

  const measurements = new Map<string, GlucoseMeasurement>();
  const contexts = new Map<number, GlucoseContext>();
  let skipped = 0;
  const subs: Subscription[] = [];

  try {
    // Leitura protegida primeiro: se o medidor exigir PIN, o SO o solicita aqui.
    const probe = await probeProtectedRead(device);
    if (probe.status === 'auth_required') {
      say('Medidor exige autenticação. Conclua o pareamento no diálogo do sistema e tente de novo.');
      return { ...base, status: 'auth_required', message: 'Autenticação/pareamento necessário.' };
    }
    say(`Glucose Feature: ${probe.status === 'ok' ? probe.hex || '(vazio)' : 'não lida (' + probe.message + ')'}`);

    let finish!: (v: { type: 'racp'; result: RacpResult; code: number } | { type: 'disconnected' }) => void;
    const done = new Promise<{ type: 'racp'; result: RacpResult; code: number } | { type: 'disconnected' }>(
      (res) => (finish = res),
    );

    const disc = device.onDisconnected(() => finish({ type: 'disconnected' }));
    subs.push(disc);

    subs.push(
      device.monitorCharacteristicForService(GLUCOSE_SERVICE, GLUCOSE_MEASUREMENT, (err, c) => {
        if (err || !c?.value) return;
        try {
          const bytes = b64ToBytes(c.value);
          say(`2A18 ← ${bytesToHex(bytes)}`);
          const m = parseGlucoseMeasurement(bytes);
          measurements.set(dedupKey(device.id, m), m);
        } catch (e) {
          skipped++;
          say(`Pacote 2A18 ignorado: ${(e as Error).message}`);
        }
      }),
    );

    if (hasContext) {
      subs.push(
        device.monitorCharacteristicForService(GLUCOSE_SERVICE, GLUCOSE_CONTEXT, (err, c) => {
          if (err || !c?.value) return;
          try {
            const bytes = b64ToBytes(c.value);
            say(`2A34 ← ${bytesToHex(bytes)}`);
            const ctx = parseGlucoseContext(bytes);
            contexts.set(ctx.sequence, ctx);
          } catch (e) {
            say(`Pacote 2A34 ignorado: ${(e as Error).message}`);
          }
        }),
      );
    }

    subs.push(
      device.monitorCharacteristicForService(GLUCOSE_SERVICE, RACP, (err, c) => {
        if (err) {
          if (isAuthError(err)) say('Erro de autenticação ao assinar RACP.');
          return;
        }
        if (!c?.value) return;
        try {
          const bytes = b64ToBytes(c.value);
          say(`2A52 ← ${bytesToHex(bytes)}`);
          const ind = parseRacpIndication(bytes);
          if (ind.type === 'response') finish({ type: 'racp', result: ind.result, code: ind.resultCode });
        } catch (e) {
          say(`Indicação RACP ignorada: ${(e as Error).message}`);
        }
      }),
    );

    // Deixa o CCCD (habilitação de notify/indicate) ser gravado antes do comando.
    await sleep(600);

    say(`2A52 → ${bytesToHex(RACP_REPORT_ALL)} (com resposta)`);
    await device.writeCharacteristicWithResponseForService(GLUCOSE_SERVICE, RACP, bytesToB64(RACP_REPORT_ALL));
    say('Escrita confirmada; aguardando indicação final do RACP…');

    const timeout = new Promise<{ type: 'timeout' }>((r) => setTimeout(() => r({ type: 'timeout' }), opts.timeoutMs ?? 60000));
    const end = await Promise.race([done, timeout]);

    // Dá tempo para notificações em trânsito chegarem depois da indicação.
    if (end.type === 'racp') await sleep(500);

    const readings = buildReadings(device, measurements, contexts);
    skipped += [...measurements.values()].filter((m) => m.mgdl === undefined).length;

    const common = { readings, skipped, log };
    if (end.type === 'timeout')
      return { ...common, status: 'timeout', message: `Tempo esgotado sem indicação final. ${readings.length} leitura(s) parcial(is) mantida(s).` };
    if (end.type === 'disconnected')
      return { ...common, status: 'disconnected', message: `Desconectado antes do fim. ${readings.length} leitura(s) parcial(is); repita para completar.` };
    if (end.result === 'success') return { ...common, status: 'success', racpResult: end.result, message: `Importação concluída: ${readings.length} leitura(s).` };
    if (end.result === 'no_records_found') return { ...common, status: 'no_records', racpResult: end.result, message: 'O medidor não tem registros.' };
    return { ...common, status: 'racp_error', racpResult: end.result, message: `Medidor respondeu erro RACP: ${end.result} (código ${end.code}).` };
  } catch (e) {
    const auth = isAuthError(e);
    say(`Falha: ${(e as Error).message}`);
    return {
      ...base,
      readings: buildReadings(device, measurements, contexts),
      skipped,
      status: auth ? 'auth_required' : 'error',
      message: auth ? 'Autenticação/pareamento necessário.' : (e as Error).message,
    };
  } finally {
    subs.forEach((s) => {
      try {
        s.remove();
      } catch {}
    });
    syncing = false;
  }
}

function buildReadings(
  device: Device,
  measurements: Map<string, GlucoseMeasurement>,
  contexts: Map<number, GlucoseContext>,
): StoredReading[] {
  const now = new Date().toISOString();
  const out: StoredReading[] = [];
  for (const [key, m] of measurements) {
    if (m.mgdl === undefined) continue; // NaN / NRes não viram leitura
    out.push({
      key,
      deviceId: device.id,
      deviceName: device.localName ?? device.name,
      sequence: m.sequence,
      baseTime: m.baseTime,
      adjustedTime: m.adjustedTime,
      timeOffsetMinutes: m.timeOffsetMinutes,
      mgdl: m.mgdl,
      meal: contexts.get(m.sequence)?.meal,
      importedAt: now,
    });
  }
  return out;
}
