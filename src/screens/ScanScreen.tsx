import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { requestBlePermissions, ScanResult, startScan } from '../ble/bleClient';
import { shortLabel } from '../ble/uuids';
import { ui } from './ui';

export function ScanScreen({ onSelect }: { onSelect: (r: ScanResult) => void }) {
  const [items, setItems] = useState<Record<string, ScanResult>>({});
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState('');
  const stopRef = useRef<null | (() => void)>(null);

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setScanning(false);
  };

  const start = async () => {
    const p = await requestBlePermissions();
    setMsg(p.detail);
    if (!p.ok) return;
    setItems({});
    setScanning(true);
    stopRef.current = startScan(
      (r) => setItems((prev) => ({ ...prev, [r.id]: { ...prev[r.id], ...r, name: r.name ?? prev[r.id]?.name ?? null } })),
      (e) => {
        setMsg(`Erro de scan: ${e.message}`);
        stop();
      },
    );
  };

  useEffect(() => () => stopRef.current?.(), []);

  const list = Object.values(items).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));

  return (
    <View style={ui.screen}>
      <Pressable style={ui.btn} onPress={scanning ? stop : start}>
        <Text style={ui.btnText}>{scanning ? 'Parar scan' : 'Escanear dispositivos BLE'}</Text>
      </Pressable>
      {!!msg && <Text style={ui.note}>{msg}</Text>}
      <Text style={ui.note}>
        Sem filtro por nome ou serviço. Ative o Bluetooth no CareTech Precision 984 (modo de pareamento/transferência, conforme o
        manual) e procure um dispositivo novo na lista. Se não souber qual é, desligue o medidor e compare o scan.
      </Text>
      <FlatList
        data={list}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <Pressable style={ui.card} onPress={() => { stop(); onSelect(item); }}>
            <Text style={ui.title}>{item.name ?? '(sem nome)'}</Text>
            <Text style={ui.mono}>{item.id}</Text>
            <Text style={styles.small}>RSSI: {item.rssi ?? '—'} dBm</Text>
            <Text style={styles.small}>
              Serviços anunciados: {item.serviceUUIDs.length ? item.serviceUUIDs.map(shortLabel).join(', ') : 'nenhum'}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={ui.note}>{scanning ? 'Procurando…' : 'Nenhum dispositivo ainda.'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({ small: { color: '#555', fontSize: 13, marginTop: 2 } });
