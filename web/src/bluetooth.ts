import {
  parseGlucoseMeasurement,
  parseRacpIndication,
  RACP_REPORT_ALL,
  RacpResult,
} from '../../src/ble/glucoseParser';
import { makeKey, StoredReading } from './store';

const GLUCOSE_SVC = '00001808-0000-1000-8000-00805f9b34fb';
const MEAS = '00002a18-0000-1000-8000-00805f9b34fb';
const RACP = '00002a52-0000-1000-8000-00805f9b34fb';

export interface ImportResult {
  status: 'success' | 'no_records' | 'racp_error' | 'timeout' | 'disconnected';
  racp?: RacpResult;
  readings: StoredReading[];
  skipped: number;
}

/**
 * Importa o histórico via Web Bluetooth (Chrome/Edge). O medidor precisa estar pareado no sistema
 * e com o Bluetooth ativo. Só escreve 01 01 no RACP do serviço 0x1808.
 */
export async function importFromMeter(log: (s: string) => void, timeoutMs = 60000): Promise<ImportResult> {
  if (!navigator.bluetooth) throw new Error('Este navegador não suporta Web Bluetooth. Use Chrome ou Edge.');
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [GLUCOSE_SVC] }] });
  log(`Selecionado: ${device.name ?? device.id}`);

  const server = await device.gatt!.connect();
  const svc = await server.getPrimaryService(GLUCOSE_SVC);
  const meas = await svc.getCharacteristic(MEAS);
  const racp = await svc.getCharacteristic(RACP);

  const found = new Map<string, StoredReading>();
  let skipped = 0;
  let finish!: (v: { racp: RacpResult } | { disconnected: true }) => void;
  const done = new Promise<{ racp: RacpResult } | { disconnected: true }>((r) => (finish = r));

  device.addEventListener('gattserverdisconnected', () => finish({ disconnected: true }));

  meas.addEventListener('characteristicvaluechanged', (ev) => {
    const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value!;
    try {
      const m = parseGlucoseMeasurement(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
      if (m.mgdl === undefined) {
        skipped++;
        return;
      }
      const key = makeKey(m.sequence, m.baseTime);
      found.set(key, {
        key,
        time: m.adjustedTime,
        mgdl: m.mgdl,
        sequence: m.sequence,
        baseTime: m.baseTime,
        offsetMinutes: m.timeOffsetMinutes,
      });
    } catch (e) {
      skipped++;
      log(`Pacote ignorado: ${(e as Error).message}`);
    }
  });

  racp.addEventListener('characteristicvaluechanged', (ev) => {
    const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value!;
    try {
      const ind = parseRacpIndication(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
      if (ind.type === 'response') finish({ racp: ind.result });
    } catch (e) {
      log(`RACP ignorado: ${(e as Error).message}`);
    }
  });

  try {
    await meas.startNotifications();
    await racp.startNotifications();
    log('Notificações ativas; solicitando todos os registros (01 01)…');
    await racp.writeValueWithResponse(RACP_REPORT_ALL as BufferSource);

    const end = await Promise.race([
      done,
      new Promise<{ timeout: true }>((r) => setTimeout(() => r({ timeout: true }), timeoutMs)),
    ]);
    await new Promise((r) => setTimeout(r, 500)); // notificações em trânsito

    const readings = [...found.values()];
    if ('timeout' in end) return { status: 'timeout', readings, skipped };
    if ('disconnected' in end) return { status: 'disconnected', readings, skipped };
    const status = end.racp === 'success' ? 'success' : end.racp === 'no_records_found' ? 'no_records' : 'racp_error';
    return { status, racp: end.racp, readings, skipped };
  } finally {
    if (device.gatt?.connected) device.gatt.disconnect();
  }
}
