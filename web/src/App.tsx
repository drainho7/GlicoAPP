import React, { useEffect, useMemo, useState } from 'react';
import { Category, filterRange, previousRange, Settings } from '../../src/analytics/analytics';
import { importFromMeter } from './bluetooth';
import {
  CategoryCards,
  ChartSection,
  Hero,
  History,
  ImportDialog,
  ImportUi,
  PeriodPicker,
  Preset,
  SettingsPanel,
} from './components';
import { addDays } from './format';
import {
  clearReadings,
  ensureBackup,
  fromScriptJson,
  loadReadings,
  loadSettings,
  mergeReadings,
  restoreFromBackup,
  saveSettings,
  StoredReading,
} from './store';

type Screen = 'inicio' | 'historico' | 'ajustes';

export default function App() {
  const [all, setAll] = useState<StoredReading[]>(loadReadings);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>('inicio');
  const [preset, setPreset] = useState<Preset>('30');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [category, setCategory] = useState<Category | 'todas'>('todas');
  const [ui, setUi] = useState<ImportUi>({ phase: 'closed' });
  const [toast, setToast] = useState('');

  // App instalado: se o armazenamento estiver vazio, restaura de Documentos\Glico\backup.json.
  useEffect(() => {
    ensureBackup();
    restoreFromBackup().then((ok) => {
      if (!ok) return;
      setAll(loadReadings());
      setSettings(loadSettings());
      setToast('Leituras restauradas do backup.');
    });
  }, []);

  // Em desenvolvimento, carrega sozinho o data/readings.json gerado pelo script (sem duplicar).
  useEffect(() => {
    fetch('/data/readings.json')
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => {
        const m = mergeReadings(fromScriptJson(t));
        setAll(m.all);
        if (m.added) setToast(`${m.added} leitura(s) carregada(s) do arquivo.`);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const last = all[all.length - 1];
  const anchor = last ? last.time.slice(0, 10) : new Date().toISOString().slice(0, 10);

  const range = useMemo<{ from?: string; to?: string }>(() => {
    if (preset === 'all') return {};
    if (preset === 'custom') return { from: cFrom || undefined, to: cTo || undefined };
    return { from: addDays(anchor, -(Number(preset) - 1)), to: anchor };
  }, [preset, cFrom, cTo, anchor]);

  const current = useMemo(() => filterRange(all, range.from, range.to), [all, range]);
  const previous = useMemo(
    () => (range.from && range.to ? filterRange(all, previousRange(range.from, range.to).from, previousRange(range.from, range.to).to) : null),
    [all, range],
  );

  const doImport = async () => {
    setUi({ phase: 'working', text: 'Abrindo a busca de dispositivos Bluetooth…' });
    try {
      const res = await importFromMeter(() => {});
      const m = mergeReadings(res.readings);
      setAll(m.all);
      const partial = res.status === 'timeout' || res.status === 'disconnected';
      const head =
        res.status === 'no_records' ? 'O medidor não tem registros.'
        : res.status === 'racp_error' ? `O medidor respondeu com erro (${res.racp}).`
        : partial ? 'A importação foi interrompida; o resultado é parcial. Tente de novo.'
        : 'Importação concluída.';
      setUi({
        phase: res.status === 'racp_error' ? 'error' : 'done',
        text: `${head} ${res.readings.length} leitura(s) recebida(s), ${m.added} nova(s).`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      setUi({
        phase: 'error',
        text: /cancel|chosen|selected/i.test(msg) ? 'Nenhum medidor foi escolhido.' : msg,
      });
    }
  };

  const exportPdf = async () => {
    const from = range.from ?? all[0]?.time.slice(0, 10);
    const to = range.to ?? last?.time.slice(0, 10);
    const q = new URLSearchParams();
    if (range.from) q.set('from', range.from);
    if (range.to) q.set('to', range.to);
    if (!window.glico) {
      window.open(`${location.pathname}#/relatorio?${q}`, '_blank'); // navegador: abre e imprime
      return;
    }
    setToast('Gerando PDF…');
    const r = await window.glico.exportPdf({ from: range.from, to: range.to, fileName: `Relatorio-Glicemia_${from}_a_${to}.pdf` });
    setToast(r.ok ? `PDF salvo em ${r.path}` : r.canceled ? '' : `Falha ao gerar o PDF: ${r.error}`);
  };

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  return (
    <div className="app">
      <header>
        <h1>Glico</h1>
        <nav>
          {([['inicio', 'Início'], ['historico', 'Histórico'], ['ajustes', 'Ajustes']] as [Screen, string][]).map(([k, l]) => (
            <button key={k} className={screen === k ? 'tab on' : 'tab'} onClick={() => setScreen(k)}>{l}</button>
          ))}
        </nav>
      </header>

      {screen !== 'ajustes' && (
        <>
          {screen === 'inicio' && <Hero last={last} settings={settings} busy={ui.phase === 'working'} onImport={doImport} />}
          {all.length === 0 ? (
            <section className="card empty">
              <h2>Vamos começar</h2>
              <p>Ligue o Bluetooth do seu medidor e toque em <b>Importar do medidor</b>. Todas as leituras guardadas nele serão trazidas.</p>
              <p className="muted">O medidor precisa estar pareado com este computador (Configurações do Windows → Bluetooth).</p>
            </section>
          ) : (
            <>
              <PeriodPicker preset={preset} setPreset={setPreset} from={cFrom} to={cTo} setFrom={setCFrom} setTo={setCTo} onPdf={exportPdf} />
              {screen === 'inicio' && (
                <>
                  <CategoryCards current={current} previous={previous} settings={settings} selected={category} onSelect={setCategory} />
                  <ChartSection readings={current} settings={settings} category={category} />
                </>
              )}
              {screen === 'historico' && <History readings={current} settings={settings} />}
            </>
          )}
        </>
      )}

      {screen === 'ajustes' && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClear={() => {
            if (confirm('Apagar as leituras salvas neste navegador? O medidor não é afetado.')) {
              clearReadings();
              setAll([]);
            }
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      <ImportDialog ui={ui} onClose={() => setUi({ phase: 'closed' })} />
    </div>
  );
}
