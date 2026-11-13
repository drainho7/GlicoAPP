/** Converte UUID curto (16 bits) para o formato de 128 bits do Bluetooth SIG. */
export function shortToUuid(short: number | string): string {
  const hex = (typeof short === 'number' ? short.toString(16) : short.replace(/^0x/i, ''))
    .toLowerCase()
    .padStart(4, '0');
  return `0000${hex}-0000-1000-8000-00805f9b34fb`;
}

/** Normaliza qualquer UUID (16, 32 ou 128 bits) para 128 bits minúsculo. */
export function normalizeUuid(uuid: string): string {
  const u = uuid.toLowerCase();
  if (u.length === 4) return shortToUuid(u);
  if (u.length === 8) return `${u}-0000-1000-8000-00805f9b34fb`;
  return u;
}

/** Retorna o UUID curto (ex.: "1808") se for um UUID base do SIG, senão o UUID completo. */
export function shortLabel(uuid: string): string {
  const u = normalizeUuid(uuid);
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(u);
  return m ? m[1].toUpperCase() : u;
}

export const GLUCOSE_SERVICE = shortToUuid(0x1808);
export const GLUCOSE_MEASUREMENT = shortToUuid(0x2a18);
export const GLUCOSE_CONTEXT = shortToUuid(0x2a34);
export const GLUCOSE_FEATURE = shortToUuid(0x2a51);
export const RACP = shortToUuid(0x2a52);

/** Nomes conhecidos para facilitar a leitura do diagnóstico. */
export const KNOWN_NAMES: Record<string, string> = {
  '1800': 'Generic Access',
  '1801': 'Generic Attribute',
  '180A': 'Device Information',
  '180F': 'Battery',
  '1808': 'Glucose Service',
  '1805': 'Current Time',
  '2A18': 'Glucose Measurement',
  '2A34': 'Glucose Measurement Context',
  '2A51': 'Glucose Feature',
  '2A52': 'Record Access Control Point',
  '2A00': 'Device Name',
  '2A19': 'Battery Level',
  '2A24': 'Model Number',
  '2A25': 'Serial Number',
  '2A26': 'Firmware Revision',
  '2A29': 'Manufacturer Name',
};
