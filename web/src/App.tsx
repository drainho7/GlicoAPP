import React, { useEffect, useMemo, useState } from 'react';
import { readSheet } from 'read-excel-file/browser';
import { annotate, assignSlotChanges, Category, filterRange, previousRange, Settings } from '../../src/analytics/analytics';
import { BodyReading, parseBodyRows } from '../../src/body/body';
import { BodyScreen } from './body';
import { importFromMeter } from './bluetooth';
import {
  A1cCard,
  CategoryCards,
  CategoryChips,
  ChartSection,
  Hero,
  History,
  ImportDialog,
  ImportUi,
  PeriodPicker,
  Preset,
  rangeFor,
  ReportDialog,
  SettingsPanel,
} from './components';
import {
  addBody,
  clearReadings,
  ensureBackup,
  fromScriptJson,
  loadBody,
  loadReadings,
  loadSettings,
  mergeReadings,
  restoreFromBackup,
  saveSettings,
  setReadingCategories,
  setReadingCategory,
  StoredReading,
} from './store';
import { localToday } from './format';

type Screen = 'inicio' | 'historico' | 'corpo' | 'ajustes';

export default function App() {
  const [raw, setAll] = useState<StoredReading[]>(loadReadings);
  const [body, setBody] = useState<BodyReading[]>(loadBody);
  const [bodyBusy, setBodyBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // Leituras com o momento (sugerido ou escolhido) e o dia da refeição já calculados.
  const all = useMemo(() => annotate(raw, settings), [raw, settings]);
  const [screen, setScreen] = useState<Screen>('inicio');
  const [preset, setPreset] = useState<Preset>('today'); // ao abrir, mostra o dia de hoje
  // Data de hoje, conferida a cada minuto: se o app ficar aberto na virada do dia, o "Hoje" acompanha.
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    const t = setInterval(() => setToday(localToday()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [category, setCategory] = useState<Category | 'todas'>('todas');
  const [ui, setUi] = useState<ImportUi>({ phase: 'closed' });
  const [toast, setToast] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  // App instalado: se o armazenamento estiver vazio, restaura de Documentos\Glico\backup.json.
  useEffect(() => {
    ensureBackup();
    restoreFromBackup().then((ok) => {
      if (!ok) return;
      setAll(loadReadings());
      setBody(loadBody());
      setSettings(loadSettings());
      setToast('Dados restaurados do backup.');
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

  // App de Windows: planilhas largadas em Documentos\Glico\Importar entram sozinhas e são movidas depois.
  useEffect(() => {
    return window.glico?.onImportFile(async ({ name, bytes }) => {
      setScreen('corpo');
      const ok = await importBody(new Blob([bytes as BlobPart]), name);
      await window.glico?.importFileDone({ name, ok });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrastar e soltar uma planilha .xlsx em qualquer tela. Sempre cancela o comportamento padrão com arquivos,
  // senão a janela "abriria" o arquivo e sairia do app.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const xlsx = Array.from(e.dataTransfer?.files ?? []).find((f) => /\.xlsx$/i.test(f.name));
      if (!xlsx) {
        setToast('Solte um arquivo .xlsx exportado pelo app da balança (OKOK).');
        return;
      }
      setScreen('corpo');
      void importBody(xlsx, xlsx.name);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const last = all[all.length - 1];
  const anchor = last ? last.time.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // `today` entra nas dependências para o período "Hoje" ser recalculado na virada do dia.
  const range = useMemo(() => rangeFor(preset, anchor, cFrom, cTo), [preset, cFrom, cTo, anchor, today]);

  const current = useMemo(() => filterRange(all, range.from, range.to), [all, range]);
  const brd = (d: string) => d.split('-').reverse().join('/');
  const periodSummary =
    `${range.from && range.to ? `${brd(range.from)} a ${brd(range.to)}` : 'todo o período'} · ${current.length} ${current.length === 1 ? 'leitura' : 'leituras'}`;
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

  const exportPdf = async (r: { from?: string; to?: string }) => {
    setReportOpen(false);
    const from = r.from ?? all[0]?.time.slice(0, 10);
    const to = r.to ?? last?.time.slice(0, 10);
    const q = new URLSearchParams();
    if (r.from) q.set('from', r.from);
    if (r.to) q.set('to', r.to);
    if (!window.glico) {
      window.open(`${location.pathname}#/relatorio?${q}`, '_blank'); // navegador: abre e imprime
      return;
    }
    // Abre a pré-visualização; de lá você salva ou imprime pelos botões do visualizador.
    setToast('Preparando a pré-visualização…');
    const res = await window.glico.previewPdf({ from: r.from, to: r.to, fileName: `Relatorio-Glicemia_${from}_a_${to}.pdf` });
    setToast(res.ok ? '' : `Falha ao gerar o relatório: ${res.error}`);
  };

  // Planilha exportada pelo app da balança (OKOK): traz todas as métricas como o app mostra.
  const importBody = async (file: Blob, label?: string): Promise<boolean> => {
    const prefix = label ? `“${label}”: ` : '';
    setBodyBusy(true);
    try {
      const parsed = parseBodyRows((await readSheet(file)) as unknown[][]);
      if (!parsed.readings.length) throw new Error('a planilha não tem pesagens válidas.');
      const m = addBody(parsed.readings);
      setBody(m.all);
      // O app da balança escreve sexo e altura acima da tabela: completa o perfil, mas só o que ainda está vazio.
      const cur = loadSettings();
      const p = cur.profile ?? {};
      const fill: { sex?: 'M' | 'F'; heightCm?: number } = {};
      if (!p.sex && parsed.meta.sex) fill.sex = parsed.meta.sex;
      if (!p.heightCm && parsed.meta.heightCm) fill.heightCm = parsed.meta.heightCm;
      const filled = Object.keys(fill).length > 0;
      if (filled) {
        const next = { ...cur, profile: { ...p, ...fill } };
        saveSettings(next);
        setSettings(next);
      }
      setToast(
        `${prefix}planilha lida: ${parsed.readings.length} pesagens, ${m.added} nova${m.added === 1 ? '' : 's'}` +
          (parsed.skipped ? ` (${parsed.skipped} linhas ignoradas).` : '.') +
          (filled ? ' Perfil completado com o sexo e a altura do arquivo (confira em Ajustes).' : ''),
      );
      return true;
    } catch (e) {
      setToast(`${prefix}não consegui ler a planilha: ${(e as Error).message}`);
      return false;
    } finally {
      setBodyBusy(false);
    }
  };

  // O usuário escolhe o momento de uma medição (ou volta ao automático, com undefined).
  const changeCategory = (key: string, c: Category | undefined) => setAll(setReadingCategory(key, c));

  // Escolhe qual medição do dia vale para Jejum/Almoço/Jantar (key vazia = nenhuma).
  const pickForSlot = (slot: 'jejum' | 'almoco' | 'janta', key: string) =>
    setAll(setReadingCategories(assignSlotChanges(current, slot, key || null, settings)));

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  return (
    <div className="app">
      <header>
        <h1>Glico</h1>
        <nav>
          {([['inicio', 'Início'], ['historico', 'Histórico'], ['corpo', 'Corpo'], ['ajustes', 'Ajustes']] as [Screen, string][]).map(([k, l]) => (
            <button key={k} className={screen === k ? 'tab on' : 'tab'} onClick={() => setScreen(k)}>{l}</button>
          ))}
        </nav>
      </header>

      {screen === 'corpo' && (
        <BodyScreen
          readings={body}
          onImport={(f) => void importBody(f)}
          busy={bodyBusy}
          profile={settings.profile}
          onOpenFolder={window.glico ? () => void window.glico!.openImportFolder() : undefined}
        />
      )}

      {(screen === 'inicio' || screen === 'historico') && (
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
              <PeriodPicker preset={preset} setPreset={setPreset} from={cFrom} to={cTo} setFrom={setCFrom} setTo={setCTo} onPdf={() => setReportOpen(true)} summary={periodSummary}
                hint={preset === 'today' && current.length === 0 ? 'Nenhuma medição hoje ainda. Importe do medidor ou escolha "7 dias" para ver os dias anteriores.' : undefined} />
              {screen === 'inicio' && (
                <>
                  <CategoryCards
                    current={current}
                    previous={previous}
                    settings={settings}
                    selected={category}
                    onSelect={setCategory}
                    list={preset === 'today' ? current : undefined}
                    onPick={pickForSlot}
                  />
                  <ChartSection readings={current} settings={settings} category={category} onCategory={setCategory} />
                  <A1cCard readings={all} settings={settings} />
                </>
              )}
              {screen === 'historico' && (
                <>
                  <CategoryChips selected={category} onSelect={setCategory} />
                  <ChartSection readings={current} settings={settings} category={category} />
                  <History readings={current} settings={settings} category={category} onCategory={changeCategory} />
                </>
              )}
            </>
          )}
        </>
      )}

      {screen === 'ajustes' && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClear={() => {
            if (confirm('Apagar as leituras de glicemia e as pesagens salvas neste computador? O medidor e a balança não são afetados.')) {
              clearReadings();
              setAll([]);
              setBody([]);
            }
          }}
        />
      )}

      {dragging && <div className="dropzone">📥 Solte a planilha do OKOK (.xlsx) para importar</div>}
      {toast && <div className="toast">{toast}</div>}
      <ImportDialog ui={ui} onClose={() => setUi({ phase: 'closed' })} />
      {reportOpen && <ReportDialog readings={all} anchor={anchor} onClose={() => setReportOpen(false)} onConfirm={exportPdf} />}
    </div>
  );
}
