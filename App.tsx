import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { ScanResult } from './src/ble/bleClient';
import { DiagnosticScreen } from './src/screens/DiagnosticScreen';
import { ReadingsScreen } from './src/screens/ReadingsScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { loadReadings, StoredReading } from './src/storage/readings';

type Tab = 'scan' | 'diag' | 'readings';

export default function App() {
  const [tab, setTab] = useState<Tab>('scan');
  const [target, setTarget] = useState<ScanResult | null>(null);
  const [readings, setReadings] = useState<StoredReading[]>([]);

  const reload = useCallback(() => { loadReadings().then(setReadings); }, []);
  useEffect(reload, [reload]);

  const tabs: [Tab, string][] = [['scan', '1. Scan'], ['diag', '2. Diagnóstico'], ['readings', '3. Medições']];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f5f4', paddingTop: StatusBar.currentHeight }}>
      <View style={styles.tabs}>
        {tabs.map(([k, label]) => (
          <Pressable key={k} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
            <Text style={[styles.tabText, tab === k && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'scan' && <ScanScreen onSelect={(r) => { setTarget(r); setTab('diag'); }} />}
      {tab === 'diag' && <DiagnosticScreen target={target} onImported={reload} />}
      {tab === 'readings' && <ReadingsScreen readings={readings} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: '#e0e4e0' },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  tabOn: { backgroundColor: '#2e7d32' },
  tabText: { fontWeight: '600', color: '#333' },
});
