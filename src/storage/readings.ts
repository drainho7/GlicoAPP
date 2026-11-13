import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StoredReading {
  key: string; // medidor|sequência|horário base
  deviceId: string;
  deviceName: string | null;
  sequence: number;
  /** Horário original do medidor (sem fuso). */
  baseTime: string;
  /** baseTime + Time Offset (sem fuso). */
  adjustedTime: string;
  timeOffsetMinutes?: number;
  mgdl: number;
  /** 1 pré-prandial, 2 pós-prandial, 3 jejum, 4 casual, 5 dormir — se o medidor enviou contexto. */
  meal?: number;
  importedAt: string;
}

const KEY = 'glico.readings.v1';

export async function loadReadings(): Promise<StoredReading[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredReading[]) : [];
  } catch {
    return [];
  }
}

/** Mescla deduplicando por `key`. Reimportar o mesmo histórico não duplica. */
export async function mergeReadings(incoming: StoredReading[]): Promise<{ added: number; total: number }> {
  const current = await loadReadings();
  const byKey = new Map(current.map((r) => [r.key, r]));
  let added = 0;
  for (const r of incoming) {
    if (!byKey.has(r.key)) {
      byKey.set(r.key, r);
      added++;
    } else if (r.meal !== undefined && byKey.get(r.key)!.meal === undefined) {
      byKey.set(r.key, { ...byKey.get(r.key)!, meal: r.meal });
    }
  }
  const all = [...byKey.values()].sort((a, b) => (a.adjustedTime < b.adjustedTime ? 1 : -1));
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
  return { added, total: all.length };
}
