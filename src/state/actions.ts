import { validateDataset } from '../core/digits';
import { FIB } from '../core/fibonacci';
import { sha256Hex } from '../core/sha256';
import { classify, MCResult, RandomControlResult } from '../core/stats';
import {
  canonicalSpec,
  HitRef,
  hitKey,
  LifeEvent,
  PreRegistration,
  SearchTerm,
  termEncoding,
  TestRun,
  TestSpec,
  AuditType,
} from '../core/types';
import { getEngine } from '../engine/client';
import { SearchSpec } from '../engine/handlers';
import {
  clearImportedDataset,
  loadImportedDataset,
  loadPersisted,
  saveImportedDataset,
  startPersisting,
} from './persist';
import { AppState, DEFAULT_ANCHOR, MapMode, PanelId, store, Tab, TermHits } from './store';

const engine = getEngine();
const nowIso = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function audit(type: AuditType, text: string) {
  store.set((s) => ({ audit: [...s.audit, { ts: nowIso(), type, text }] }));
}

let toastSeq = 0;
export function toast(text: string) {
  const id = ++toastSeq;
  store.set({ toast: { text, id } });
  setTimeout(() => {
    if (store.get().toast?.id === id) store.set({ toast: null });
  }, 2600);
}

// ------------------------------------------------------------------ käynnistys ja aineisto

export async function initApp(): Promise<void> {
  const persisted = loadPersisted();
  if (persisted) store.set(persisted as Partial<AppState>);
  const a = store.get().anchor;
  store.set({ selection: { termId: a.termId, n: a.n } });
  store.set({ engineMode: engine.mode });
  engine.onModeChange((m) => store.set({ engineMode: m }));
  startPersisting();
  const hash = location.hash.replace('#', '');
  if (hash === 'avaruus') store.set({ tab: 'space' });
  if (hash === 'kartta') store.set({ tab: 'map' });
  if (hash === 'numerot') store.set({ tab: 'digits' });
  if (hash === 'testit') store.set({ tab: 'tests' });
  if (hash === 'matriisi') store.set({ tab: 'matrix' });
  const imported = await loadImportedDataset();
  if (imported && (await applyDataset(imported.digits, imported.name, 'imported'))) return;
  await loadBundled();
}

export async function loadBundled(): Promise<void> {
  store.set((s) => ({ dataset: { ...s.dataset, status: 'loading', error: null, progress: 0 } }));
  try {
    const url = new URL('data/pi_digits_1m.txt', document.baseURI).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 1_000_000;
    let text = '';
    if (res.body && 'getReader' in res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        text += dec.decode(value, { stream: true });
        store.set((s) => ({ dataset: { ...s.dataset, progress: Math.min(0.99, got / total) } }));
      }
      text += dec.decode();
    } else {
      text = await res.text();
    }
    await applyDataset(text, 'pi_digits_1m.txt', 'bundled');
  } catch (e) {
    store.set((s) => ({
      dataset: {
        ...s.dataset,
        status: 'error',
        error: `Mukana tulevaa numerotiedostoa ei voitu ladata (${e instanceof Error ? e.message : e}). Tuo tiedosto Testit-välilehdeltä.`,
      },
    }));
  }
}

export async function applyDataset(raw: string, name: string, source: 'bundled' | 'imported'): Promise<boolean> {
  const v = await validateDataset(raw, name);
  if (!v.ok || !v.info) {
    store.set((s) => ({ dataset: { ...s.dataset, status: s.digits ? 'ready' : 'error', error: v.error } }));
    toast(v.error ?? 'Tiedostoa ei hyväksytty');
    return false;
  }
  const prev = store.get().dataset.info;
  store.set({ digits: v.digits, dataset: { status: 'ready', info: v.info, error: null, progress: 1, source } });
  if (prev && prev.sha256 !== v.info.sha256) {
    audit('aineisto', `Aineisto vaihdettiin: ${prev.name} (${prev.length}) → ${name} (${v.info.length}), SHA-256 ${v.info.sha256.slice(0, 12)}…`);
  }
  await engine.call({ type: 'setDigits', digits: v.digits });
  await searchAll();
  return true;
}

export async function importDatasetFile(file: File): Promise<void> {
  store.set((s) => ({ dataset: { ...s.dataset, status: 'loading', progress: 0.5 } }));
  const raw = await file.text();
  const ok = await applyDataset(raw, file.name, 'imported');
  if (ok) {
    const saved = await saveImportedDataset(file.name, store.get().digits);
    toast(saved ? `${file.name} ladattu ja tallennettu laitteelle` : `${file.name} ladattu (ei tallennettu laitteelle)`);
  }
}

export async function revertToBundled(): Promise<void> {
  await clearImportedDataset();
  await loadBundled();
}

// ------------------------------------------------------------------ haku

function specFor(t: SearchTerm): SearchSpec | { error: string } {
  const enc = termEncoding(t);
  if (!enc.ok) return { error: enc.errors.join(' ') };
  if (t.mode === 'fibSkip') {
    const step = FIB[t.fibK ?? 10];
    return { id: t.id, code: enc.code, mode: 'fibSkip', step };
  }
  return { id: t.id, code: enc.code, mode: 'contiguous' };
}

export async function searchAll(ids?: string[]): Promise<void> {
  const s = store.get();
  if (!s.digits) return;
  const terms = ids ? s.terms.filter((t) => ids.includes(t.id)) : s.terms;
  const specs: SearchSpec[] = [];
  const hits: Record<string, TermHits> = { ...s.hits };
  for (const t of terms) {
    const sp = specFor(t);
    if ('error' in sp) {
      hits[t.id] = {
        status: 'error', code: '', hits: new Int32Array(0), count: 0, expected: 0, positions: 0, truncated: false, ms: 0, error: sp.error,
      };
      continue;
    }
    specs.push(sp);
    const prev = hits[t.id];
    hits[t.id] = prev && prev.code === sp.code ? { ...prev, status: 'searching' } : {
      status: 'searching', code: sp.code, hits: new Int32Array(0), count: 0, expected: 0, positions: 0, truncated: false, ms: 0,
    };
  }
  store.set({ hits });
  if (!specs.length) return;
  try {
    const res = await engine.call({ type: 'search', specs });
    store.set((st) => {
      const next = { ...st.hits };
      for (const r of res) {
        const t = st.terms.find((x) => x.id === r.id);
        if (!t) continue;
        const cur = specFor(t);
        if ('error' in cur || cur.code !== r.code) continue; // termi muuttui haun aikana
        next[r.id] = {
          status: 'ready', code: r.code, hits: r.hits, count: r.count, expected: r.expected, positions: r.positions, truncated: r.truncated, ms: r.ms,
        };
      }
      return { hits: next };
    });
  } catch (e) {
    toast(`Haku epäonnistui: ${e instanceof Error ? e.message : e}`);
  }
}

export function getTerm(id: string): SearchTerm | undefined {
  return store.get().terms.find((t) => t.id === id);
}

export function addTerm(t: Omit<SearchTerm, 'id' | 'createdAt'>): string {
  const id = uid('t');
  const term: SearchTerm = { ...t, id, createdAt: nowIso() };
  store.set((s) => ({ terms: [...s.terms, term] }));
  const enc = termEncoding(term);
  audit('termi', `Lisätty hakutermi ${term.label} (${term.encoding} ${enc.code}${term.mode === 'fibSkip' ? `, kokeellinen F_${term.fibK}-hyppy` : ''})`);
  void searchAll([id]);
  return id;
}

export function updateTerm(id: string, patch: Partial<SearchTerm>) {
  const before = getTerm(id);
  store.set((s) => ({ terms: s.terms.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const after = getTerm(id);
  if (before && after && specKey(before) !== specKey(after)) void searchAll([id]);
}

function specKey(t: SearchTerm) {
  const sp = specFor(t);
  return 'error' in sp ? `err:${sp.error}` : `${sp.code}:${sp.mode}:${sp.step ?? ''}`;
}

export function removeTerm(id: string) {
  const t = getTerm(id);
  if (!t) return;
  if (store.get().anchor.termId === id) {
    toast('Ankkurin termiä ei voi poistaa. Vaihda ensin ankkuri.');
    return;
  }
  store.set((s) => {
    const hits = { ...s.hits };
    delete hits[id];
    return {
      terms: s.terms.filter((x) => x.id !== id),
      hits,
      selection: s.selection?.termId === id ? { termId: s.anchor.termId, n: s.anchor.n } : s.selection,
    };
  });
  audit('termi', `Poistettu hakutermi ${t.label}`);
}

// ------------------------------------------------------------------ valinta ja ankkuri

export function select(ref: HitRef | null, opts: { tab?: Tab; expand?: boolean } = {}) {
  store.set((s) => ({
    selection: ref,
    focusN: ref ? null : s.focusN,
    tab: opts.tab ?? s.tab,
    sheetExpanded: opts.expand ?? s.sheetExpanded,
  }));
}

export function selectAnchor(tab?: Tab) {
  const a = store.get().anchor;
  select({ termId: a.termId, n: a.n }, { tab });
}

export function setAnchor(ref: HitRef) {
  const s = store.get();
  const t = getTerm(ref.termId);
  const code = s.hits[ref.termId]?.code ?? '';
  if (!t) return;
  const prev = s.anchor;
  if (prev.termId === ref.termId && prev.n === ref.n) return;
  store.set({ anchor: { termId: ref.termId, n: ref.n, label: t.label, code, setAt: nowIso() } });
  audit('ankkuri', `Ankkuri vaihdettu: ${prev.label} ${prev.code} @${prev.n} → ${t.label} ${code} @${ref.n}`);
  toast(`Ankkuri: ${t.label} @${ref.n.toLocaleString('fi-FI')}`);
}

export function resetAnchor() {
  const s = store.get();
  if (!s.terms.some((t) => t.id === DEFAULT_ANCHOR.termId)) {
    toast('IDA-termi puuttuu. Lisää IDA (T9) ennen palautusta.');
    return;
  }
  if (s.anchor.termId !== DEFAULT_ANCHOR.termId || s.anchor.n !== DEFAULT_ANCHOR.n) {
    audit('ankkuri', `Ankkuri palautettu: ${s.anchor.label} @${s.anchor.n} → IDA 432 @858511`);
    store.set({ anchor: { ...DEFAULT_ANCHOR, setAt: nowIso() } });
  }
  select({ termId: DEFAULT_ANCHOR.termId, n: DEFAULT_ANCHOR.n });
}

export const setTab = (tab: Tab) => store.set({ tab, sheetExpanded: false });
export const setMapMode = (mapMode: MapMode) => store.set({ mapMode });
export const openPanel = (panel: PanelId | null) => store.set({ panel });
export const setPrefs = (p: Partial<AppState['prefs']>) => store.set((s) => ({ prefs: { ...s.prefs, ...p } }));

export function focusIndex(n: number) {
  store.set({ focusN: n, selection: null, tab: 'digits' });
}

// ------------------------------------------------------------------ muistiinpanot ja tapahtumat

export function setNote(key: string, text: string) {
  store.set((s) => {
    const notes = { ...s.notes };
    if (text.trim()) notes[key] = text;
    else delete notes[key];
    return { notes };
  });
}

export function addEvent(e: Omit<LifeEvent, 'id' | 'createdAt' | 'linkedHits'> & { linkedHits?: string[] }): string {
  const id = uid('e');
  store.set((s) => ({ events: [...s.events, { ...e, linkedHits: e.linkedHits ?? [], id, createdAt: nowIso() }] }));
  audit('tapahtuma', `Lisätty elämäntapahtuma "${e.title}" (${e.date})`);
  return id;
}

export function updateEvent(id: string, patch: Partial<LifeEvent>) {
  store.set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
}

export function removeEvent(id: string) {
  const e = store.get().events.find((x) => x.id === id);
  store.set((s) => ({ events: s.events.filter((x) => x.id !== id) }));
  if (e) audit('tapahtuma', `Poistettu elämäntapahtuma "${e.title}"`);
}

export function toggleEventLink(eventId: string, ref: HitRef) {
  const key = hitKey(ref);
  const e = store.get().events.find((x) => x.id === eventId);
  if (!e) return;
  const linked = e.linkedHits.includes(key);
  updateEvent(eventId, { linkedHits: linked ? e.linkedHits.filter((k) => k !== key) : [...e.linkedHits, key] });
  audit('tapahtuma', `${linked ? 'Poistettu linkitys' : 'Käyttäjä linkitti'}: "${e.title}" ↔ ${key}`);
}

// ------------------------------------------------------------------ testit

export async function lockPreregistration(hypothesis: string, spec: TestSpec): Promise<PreRegistration> {
  const createdAt = nowIso();
  const hash = await sha256Hex(`${hypothesis}\n${canonicalSpec(spec)}\n${createdAt}`);
  const p: PreRegistration = { id: uid('pr'), createdAt, hypothesis, spec, hash };
  store.set((s) => ({ prereg: [...s.prereg, p] }));
  audit('esirekisteröinti', `Hypoteesi lukittu ennen ajoa (${hash.slice(0, 12)}…): ${hypothesis}`);
  return p;
}

export async function runMonteCarloTest(
  spec: TestSpec,
  preregId: string | null,
  onProgress: (done: number, total: number) => void,
): Promise<{ result: MCResult; run: TestRun }> {
  const s = store.get();
  const hA = s.hits[spec.termA];
  const hB = s.hits[spec.termB];
  if (!hA || !hB || hA.status !== 'ready' || hB.status !== 'ready') throw new Error('Termien haku on kesken.');
  const result = await engine.call(
    {
      type: 'monteCarlo',
      params: {
        metric: spec.metric,
        statistic: spec.statistic,
        hitsA: Array.from(hA.hits),
        lenA: spec.codeA.length,
        hitsB: Array.from(hB.hits),
        lenB: spec.codeB.length,
        sameTerm: spec.termA === spec.termB,
        anchorN: spec.statistic === 'anchorNearest' ? spec.anchorN : null,
        N: s.digits.length,
        R: spec.R,
        seed: spec.seed,
        alpha: spec.alpha,
      },
    },
    onProgress,
  );
  const verdict = classify(result.pValue, spec.alpha, !!preregId).verdict;
  const run: TestRun = {
    id: uid('run'),
    ts: nowIso(),
    kind: 'monte-carlo',
    spec,
    preregId,
    verdict,
    summary: {
      observed: result.observed,
      pValue: result.pValue,
      pLow: result.pLow,
      pHigh: result.pHigh,
      shareGreater: result.shareGreater,
      kA: result.params.kA,
      kB: result.params.kB,
      nullMedian: result.nullMedian,
      nullQ05: result.nullQ05,
      nullQ95: result.nullQ95,
      durationMs: result.durationMs,
      version: result.version,
    },
  };
  store.set((st) => ({ runs: [...st.runs, run] }));
  audit('testi', `Monte Carlo ${spec.statistic}/${spec.metric} ${spec.labelA}–${spec.labelB}, R=${spec.R}, siemen ${spec.seed}: p=${result.pValue.toPrecision(3)}${preregId ? ' (lukittu)' : ' (eksploratiivinen)'}`);
  return { result, run };
}

export async function runRandomControlTest(
  spec: TestSpec,
  strings: number,
  onProgress: (done: number, total: number) => void,
): Promise<{ result: RandomControlResult; run: TestRun }> {
  const s = store.get();
  const statistic = spec.statistic === 'anchorNearest' ? 'setMin' : spec.statistic;
  const result = await engine.call(
    {
      type: 'randomControl',
      params: { codeA: spec.codeA, codeB: spec.codeB, metric: spec.metric, statistic, N: s.digits.length, strings, seed: spec.seed },
    },
    onProgress,
  );
  const share = result.shareLE;
  const pApprox = (result.rows.filter((r) => r.value <= result.pi.value).length + 1) / (result.rows.length + 1);
  const run: TestRun = {
    id: uid('rc'),
    ts: nowIso(),
    kind: 'random-control',
    spec: { ...spec, statistic, R: strings },
    preregId: null,
    verdict: classify(pApprox, spec.alpha, false).verdict,
    shareLE: share,
    summary: {
      observed: result.pi.value,
      pValue: pApprox,
      pLow: NaN,
      pHigh: NaN,
      shareGreater: 1 - share,
      kA: result.pi.countA,
      kB: result.pi.countB,
      nullMedian: NaN,
      nullQ05: NaN,
      nullQ95: NaN,
      durationMs: result.durationMs,
      version: result.version,
    },
  };
  store.set((st) => ({ runs: [...st.runs, run] }));
  audit('testi', `Satunnaisaineistokontrolli ${spec.labelA}–${spec.labelB}, ${strings} jonoa, siemen ${spec.seed}: osuus ≤ pii ${(share * 100).toFixed(1)} %`);
  return { result, run };
}

export function clearRuns() {
  const n = store.get().runs.length;
  store.set({ runs: [] });
  audit('testi', `Testiloki tyhjennetty (${n} ajoa). Ajojen määrä kirjattu tähän monivertailua varten.`);
}

export async function cancelEngine() {
  await engine.cancel();
}
