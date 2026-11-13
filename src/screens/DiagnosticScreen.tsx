import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Device } from 'react-native-ble-plx';
import {
  checkGlucoseSupport,
  connectDevice,
  discoverGatt,
  getManager,
  GattService,
  probeProtectedRead,
  ScanResult,
} from '../ble/bleClient';
import { importHistory, SyncOutcome } from '../ble/syncService';
import { GLUCOSE_CONTEXT, KNOWN_NAMES, shortLabel } from '../ble/uuids';
import { mergeReadings } from '../storage/readings';
import { ui } from './ui';

type Step = 'idle' | 'ok' | 'fail' | 'pending';
const mark = (s: Step) => (s === 'ok' ? '✅' : s === 'fail' ? '❌' : s === 'pending' ? '⏳' : '▫️');

export function DiagnosticScreen({ target, onImported }: { target: ScanResult | null; onImported: () => void }) {
  const deviceRef = useRef<Device | null>(null);
  const [conn, setConn] = useState<Step>('idle');
  const [gattStep, setGattStep] = useState<Step>('idle');
  const [auth, setAuth] = useState<string>('Não testado');
  const [gatt, setGatt] = useState<GattService[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  useEffect(() => {
    setConn('idle'); setGattStep('idle'); setGatt([]); setErr(''); setAuth('Não testado'); setOutcome(null); setLog([]);
    deviceRef.current = null;
  }, [target?.id]);

  if (!target) return <View style={ui.screen}><Text style={ui.note}>Selecione um dispositivo na aba Scan.</Text></View>;

  const support = gatt.length ? checkGlucoseSupport(gatt) : null;

  const connectAndDiscover = async () => {
    setBusy(true); setErr(''); setConn('pending'); setGattStep('idle'); setGatt([]);
    try {
      const dev = await connectDevice(target.id);
      deviceRef.current = dev;
      setConn('ok');
      setGattStep('pending');
      const g = await discoverGatt(dev);
      setGatt(g);
      setGattStep('ok');
    } catch (e) {
      setErr((e as Error).message);
      setConn((c) => (c === 'pending' ? 'fail' : c));
      setGattStep((c) => (c === 'pending' ? 'fail' : c));
    } finally {
      setBusy(false);
    }
  };

  const testAuth = async () => {
    if (!deviceRef.current) return;
    setAuth('Testando… (se o medidor exigir, o sistema mostrará o pedido de PIN)');
    const r = await probeProtectedRead(deviceRef.current);
    setAuth(
      r.status === 'ok'
        ? `Leitura protegida OK (Glucose Feature: ${r.hex || 'vazio'}). Sem autenticação pendente.`
        : r.status === 'auth_required'
          ? 'Autenticação exigida. Conclua o pareamento no diálogo do sistema e teste de novo.'
          : `Leitura falhou: ${r.message}`,
    );
  };

  const doImport = async () => {
    if (!deviceRef.current || !support?.supported) return;
    setBusy(true); setLog([]); setOutcome(null);
    const res = await importHistory(deviceRef.current, support.hasContext, { onLog: (l) => setLog((p) => [...p, l]) });
    if (res.readings.length) {
      const m = await mergeReadings(res.readings);
      res.message += ` Novas: ${m.added}, total salvo: ${m.total}.`;
      onImported();
    }
    setOutcome(res);
    setBusy(false);
  };

  const disconnect = async () => {
    await getManager().cancelDeviceConnection(target.id).catch(() => {});
    setConn('idle'); setGattStep('idle');
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={ui.card}>
        <Text style={ui.title}>{target.name ?? '(sem nome)'}</Text>
        <Text style={ui.mono}>{target.id}</Text>
        <Text style={ui.note}>{mark(conn)} Conexão BLE</Text>
        <Text style={ui.note}>{mark(gattStep)} Descoberta GATT</Text>
        <Text style={ui.note}>🔐 Pareamento/autenticação: {auth}</Text>
        <Text style={ui.note}>
          São etapas distintas: conectar não implica parear, e parear só ocorre se o medidor exigir criptografia.
        </Text>
      </View>

      <Pressable style={[ui.btn, busy && ui.btnDisabled]} disabled={busy} onPress={connectAndDiscover}>
        <Text style={ui.btnText}>Conectar e descobrir GATT</Text>
      </Pressable>
      <Pressable style={[ui.btn, ui.btnAlt, (!deviceRef.current || busy) && ui.btnDisabled]} disabled={!deviceRef.current || busy} onPress={testAuth}>
        <Text style={ui.btnText}>Testar autenticação (leitura 0x2A51)</Text>
      </Pressable>
      {busy && <ActivityIndicator style={{ margin: 8 }} />}
      {!!err && <Text style={ui.bad}>{err}</Text>}

      {support && (
        <View style={ui.card}>
          {support.supported ? (
            <Text style={ui.ok}>Glucose Service (0x1808) confirmado: importação habilitada.</Text>
          ) : (
            <>
              <Text style={ui.warn}>Glucose Service padrão NÃO confirmado. Importação desabilitada.</Text>
              <Text style={ui.note}>Faltando: {support.missing.join('; ')}</Text>
              <Text style={ui.note}>
                Veja os serviços encontrados abaixo. Nenhuma escrita é feita em características proprietárias.
              </Text>
            </>
          )}
          {support.hasService && <Text style={ui.note}>Contexto 0x2A34: {support.hasContext ? 'sim' : 'não'} · Feature 0x2A51: {support.hasFeature ? 'sim' : 'não'}</Text>}
        </View>
      )}

      <Pressable
        style={[ui.btn, (!support?.supported || busy) && ui.btnDisabled]}
        disabled={!support?.supported || busy}
        onPress={doImport}
      >
        <Text style={ui.btnText}>Importar histórico</Text>
      </Pressable>
      {outcome && (
        <View style={ui.card}>
          <Text style={outcome.status === 'success' || outcome.status === 'no_records' ? ui.ok : ui.bad}>{outcome.message}</Text>
          {outcome.skipped > 0 && <Text style={ui.note}>Ignorados (sem valor numérico/ilegíveis): {outcome.skipped}</Text>}
        </View>
      )}
      {log.length > 0 && (
        <View style={ui.card}>
          <Text style={ui.title}>Log do protocolo</Text>
          {log.map((l, i) => <Text key={i} style={ui.mono}>{l}</Text>)}
        </View>
      )}

      {conn === 'ok' && <Pressable style={[ui.btn, ui.btnAlt]} onPress={disconnect}><Text style={ui.btnText}>Desconectar</Text></Pressable>}

      {gatt.map((s) => (
        <View key={s.uuid} style={ui.card}>
          <Text style={ui.title}>
            Serviço {shortLabel(s.uuid)} {KNOWN_NAMES[shortLabel(s.uuid)] ? `· ${KNOWN_NAMES[shortLabel(s.uuid)]}` : ''}
          </Text>
          <Text style={ui.mono}>{s.uuid}</Text>
          {s.characteristics.map((c) => (
            <View key={c.uuid} style={{ marginTop: 8 }}>
              <Text style={ui.mono}>
                {shortLabel(c.uuid)} {KNOWN_NAMES[shortLabel(c.uuid)] ? `· ${KNOWN_NAMES[shortLabel(c.uuid)]}` : ''}
              </Text>
              <Text style={ui.mono}>{c.uuid}</Text>
              <View style={ui.row}>
                {c.isReadable && <Text style={ui.badge}>Read</Text>}
                {c.isWritableWithResponse && <Text style={ui.badge}>Write</Text>}
                {c.isWritableWithoutResponse && <Text style={ui.badge}>Write w/o resp</Text>}
                {c.isNotifiable && <Text style={ui.badge}>Notify</Text>}
                {c.isIndicatable && <Text style={ui.badge}>Indicate</Text>}
              </View>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
