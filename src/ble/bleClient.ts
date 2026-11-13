import { PermissionsAndroid, Platform } from 'react-native';
import { BleError, BleManager, Characteristic, Device, Service } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { GLUCOSE_FEATURE, GLUCOSE_MEASUREMENT, GLUCOSE_CONTEXT, GLUCOSE_SERVICE, RACP, normalizeUuid } from './uuids';

let manager: BleManager | null = null;
export function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

export const b64ToBytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));
export const bytesToB64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
export const bytesToHex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join(' ');

/* ---------------- Permissões ---------------- */

export async function requestBlePermissions(): Promise<{ ok: boolean; detail: string }> {
  if (Platform.OS !== 'android') return { ok: true, detail: 'iOS: o sistema pede permissão ao primeiro uso do Bluetooth.' };
  const api = Number(Platform.Version);
  if (api >= 31) {
    const r = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    const ok = Object.values(r).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
    return { ok, detail: ok ? 'BLUETOOTH_SCAN e BLUETOOTH_CONNECT concedidas.' : 'Permissão Bluetooth negada.' };
  }
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  const ok = r === PermissionsAndroid.RESULTS.GRANTED;
  return { ok, detail: ok ? 'Localização concedida (exigida para scan BLE no Android ≤ 11).' : 'Permissão de localização negada.' };
}

/* ---------------- Scan ---------------- */

export interface ScanResult {
  id: string;
  name: string | null;
  rssi: number | null;
  serviceUUIDs: string[];
  lastSeen: number;
}

/** Scan SEM filtro de nome nem de serviço. Retorna função para parar. */
export function startScan(onUpdate: (r: ScanResult) => void, onError: (e: BleError) => void): () => void {
  const m = getManager();
  m.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
    if (error) return onError(error);
    if (!device) return;
    onUpdate({
      id: device.id,
      name: device.localName ?? device.name,
      rssi: device.rssi,
      serviceUUIDs: device.serviceUUIDs ?? [],
      lastSeen: Date.now(),
    });
  });
  return () => m.stopDeviceScan();
}

/* ---------------- Conexão e GATT ---------------- */

export interface GattCharacteristic {
  uuid: string;
  isReadable: boolean;
  isWritableWithResponse: boolean;
  isWritableWithoutResponse: boolean;
  isNotifiable: boolean;
  isIndicatable: boolean;
}
export interface GattService {
  uuid: string;
  characteristics: GattCharacteristic[];
}

export async function connectDevice(id: string): Promise<Device> {
  const m = getManager();
  const existing = await m.isDeviceConnected(id).catch(() => false);
  if (existing) return (await m.devices([id]))[0];
  return m.connectToDevice(id, { timeout: 15000 });
}

export async function discoverGatt(device: Device): Promise<GattService[]> {
  const d = await device.discoverAllServicesAndCharacteristics();
  const services: Service[] = await d.services();
  const out: GattService[] = [];
  for (const s of services) {
    const chars: Characteristic[] = await s.characteristics();
    out.push({
      uuid: normalizeUuid(s.uuid),
      characteristics: chars.map((c) => ({
        uuid: normalizeUuid(c.uuid),
        isReadable: c.isReadable,
        isWritableWithResponse: c.isWritableWithResponse,
        isWritableWithoutResponse: c.isWritableWithoutResponse,
        isNotifiable: c.isNotifiable,
        isIndicatable: c.isIndicatable,
      })),
    });
  }
  return out;
}

export interface GlucoseSupport {
  supported: boolean;
  hasService: boolean;
  hasMeasurement: boolean;
  hasRacp: boolean;
  hasContext: boolean;
  hasFeature: boolean;
  missing: string[];
}

/** Importação só é habilitada se 0x1808 + 0x2A18 (notify) + 0x2A52 (write + indicate) existirem. */
export function checkGlucoseSupport(gatt: GattService[]): GlucoseSupport {
  const svc = gatt.find((s) => s.uuid === GLUCOSE_SERVICE);
  const find = (u: string) => svc?.characteristics.find((c) => c.uuid === u);
  const meas = find(GLUCOSE_MEASUREMENT);
  const racp = find(RACP);
  const missing: string[] = [];
  if (!svc) missing.push('Serviço 0x1808');
  if (!meas?.isNotifiable) missing.push('0x2A18 com Notify');
  if (!racp || !racp.isIndicatable || !(racp.isWritableWithResponse || racp.isWritableWithoutResponse))
    missing.push('0x2A52 com Write + Indicate');
  return {
    supported: missing.length === 0,
    hasService: !!svc,
    hasMeasurement: !!meas,
    hasRacp: !!racp,
    hasContext: !!find(GLUCOSE_CONTEXT),
    hasFeature: !!find(GLUCOSE_FEATURE),
    missing,
  };
}

/* ---------------- Autenticação / pareamento ---------------- */

export function isAuthError(e: unknown): boolean {
  const err = e as Partial<BleError> | undefined;
  if (!err) return false;
  // ATT 0x05 Insufficient Authentication, 0x0F Insufficient Encryption, 0x08 Insufficient Authorization
  if (err.attErrorCode === 5 || err.attErrorCode === 15 || err.attErrorCode === 8) return true;
  return /authenticat|insufficient|bond|encrypt|pairing|pin/i.test(`${err.message ?? ''} ${err.reason ?? ''}`);
}

/**
 * Leitura segura (somente leitura) de uma característica padrão (0x2A51 Glucose Feature).
 * Serve para provocar a autenticação do SO caso o medidor a exija: o Android/iOS mostra o diálogo de PIN.
 */
export async function probeProtectedRead(
  device: Device,
): Promise<{ status: 'ok' | 'auth_required' | 'error'; hex?: string; message?: string }> {
  try {
    const c = await device.readCharacteristicForService(GLUCOSE_SERVICE, GLUCOSE_FEATURE);
    return { status: 'ok', hex: c.value ? bytesToHex(b64ToBytes(c.value)) : '' };
  } catch (e) {
    if (isAuthError(e)) return { status: 'auth_required', message: (e as Error).message };
    return { status: 'error', message: (e as Error).message };
  }
}

/** Android: tenta iniciar pareamento do sistema (o SO exibe o PIN). No iOS o diálogo vem na 1ª leitura protegida. */
export async function requestSystemPairing(device: Device): Promise<void> {
  // ble-plx não expõe createBond(); a leitura protegida já aciona o pareamento no SO.
  await probeProtectedRead(device);
}
