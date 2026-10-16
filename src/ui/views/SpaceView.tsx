import { useEffect, useMemo, useRef, useState } from 'react';
import { FIB } from '../../core/fibonacci';
import { select, setPrefs, setTab } from '../../state/actions';
import { useCompanions } from '../../state/derived';
import { store, useApp } from '../../state/store';
import { fmtN } from '../format';
import { SceneTerm, SpaceScene } from './space-scene';

const WINDOWS: { label: string; v: number | null }[] = [
  { label: 'Kaikki n', v: null },
  { label: '±100 000', v: 100_000 },
  { label: '±10 000', v: 10_000 },
  { label: '±1 000', v: 1000 },
];

export function SpaceView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const [webglOk, setWebglOk] = useState(true);
  const terms = useApp((s) => s.terms);
  const hits = useApp((s) => s.hits);
  const anchor = useApp((s) => s.anchor);
  const selection = useApp((s) => s.selection);
  const mode = useApp((s) => s.spaceMode);
  const prefs = useApp((s) => s.prefs);
  const N = useApp((s) => s.digits.length);
  const companions = useCompanions();

  useEffect(() => {
    const sc = new SpaceScene(hostRef.current!, labelsRef.current!, (hit) => {
      if (hit) select(hit, { expand: false });
    });
    sceneRef.current = sc;
    setWebglOk(sc.ok);
    (window as unknown as { __piatlasScene?: SpaceScene }).__piatlasScene = sc;
    return () => {
      sc.dispose();
      sceneRef.current = null;
    };
  }, []);

  const sceneTerms: SceneTerm[] = useMemo(
    () =>
      terms
        .filter((t) => t.visible)
        .map((t) => {
          const h = hits[t.id];
          return {
            id: t.id,
            label: t.label,
            color: t.color,
            hits: h && h.status === 'ready' ? h.hits : new Int32Array(0),
            len: h?.code.length ?? 0,
            step: t.mode === 'fibSkip' ? FIB[t.fibK ?? 10] : 1,
          };
        }),
    [terms, hits],
  );

  useEffect(() => {
    sceneRef.current?.setData({
      terms: sceneTerms,
      mode,
      N,
      showSamples: prefs.showSamples,
      colorBy: prefs.colorBy,
      window: prefs.indexWindow ? { center: anchor.n, radius: prefs.indexWindow } : null,
    });
  }, [sceneTerms, mode, N, prefs.showSamples, prefs.colorBy, prefs.indexWindow, anchor.n]);

  useEffect(() => {
    const termOf = (id: string) => terms.find((t) => t.id === id);
    const at = termOf(anchor.termId);
    const st = selection ? termOf(selection.termId) : undefined;
    const sh = selection ? hits[selection.termId] : undefined;
    sceneRef.current?.setMarks({
      anchor: at ? { termId: anchor.termId, n: anchor.n, label: at.label, color: at.color } : null,
      selected:
        selection && st
          ? {
              termId: selection.termId,
              n: selection.n,
              label: st.label,
              color: st.color,
              len: Math.min(sh?.code.length ?? 1, 16),
              step: st.mode === 'fibSkip' ? FIB[st.fibK ?? 10] : 1,
            }
          : null,
      companions: companions
        .map((c) => {
          const t = termOf(c.termId);
          return t ? { ...c, label: t.label, color: t.color } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
      showPath: prefs.showPath,
    });
  }, [selection, anchor, companions, terms, hits, prefs.showPath, sceneTerms]);

  useEffect(() => {
    sceneRef.current?.setAutoRotate(prefs.autoRotate);
  }, [prefs.autoRotate]);

  const visibleCount = sceneTerms.reduce((a, t) => a + t.hits.length, 0);

  return (
    <div className="view" data-testid="space-view">
      <div className="canvas-host" ref={hostRef} />
      <div className="labels" ref={labelsRef} />
      {!webglOk && (
        <div className="page">
          <div className="note err">
            Tämä selain ei tue WebGL:ää, joten 3D-näkymä ei käynnisty. Kartta- ja Numerot-välilehdet toimivat.
          </div>
          <button className="btn" onClick={() => setTab('map')}>
            Avaa 2D-kartta
          </button>
        </div>
      )}
      <div className="overlay-top">
        <div className="seg" role="group" aria-label="3D-kartoitus">
          <button aria-pressed={mode === 'octa'} onClick={() => store.set({ spaceMode: 'octa' })}>
            Oktaedri
          </button>
          <button className="legacy" aria-pressed={mode === 'legacy'} onClick={() => store.set({ spaceMode: 'legacy' })}>
            Legacy N={N >= 1e6 ? `${N / 1e6}M` : fmtN(N)}
          </button>
        </div>
        <button className="toggle" aria-pressed={prefs.showSamples} onClick={() => setPrefs({ showSamples: !prefs.showSamples })}>
          <span className="dot" /> Näytepisteet
        </button>
        <button className="toggle" aria-pressed={prefs.showPath} onClick={() => setPrefs({ showPath: !prefs.showPath })}>
          <span className="dot" /> Polku
        </button>
        <button
          className="toggle"
          aria-pressed={prefs.colorBy === 'index'}
          onClick={() => setPrefs({ colorBy: prefs.colorBy === 'index' ? 'term' : 'index' })}
          title="Väritä näytepisteet π-järjestysajan n mukaan (4. koordinaatti)"
        >
          <span className="dot" /> 4D: väri n
        </button>
        <select
          className="toggle"
          aria-label="π-indeksin ikkuna ankkurin ympärillä"
          value={prefs.indexWindow ?? ''}
          onChange={(e) => setPrefs({ indexWindow: e.target.value ? Number(e.target.value) : null })}
        >
          {WINDOWS.map((w) => (
            <option key={w.label} value={w.v ?? ''}>
              {w.label}
            </option>
          ))}
        </select>
        <button className="toggle" onClick={() => sceneRef.current?.resetCamera()}>
          Keskitä
        </button>
        {mode === 'legacy' && (
          <div className="badge-legacy" role="status">
            LEGACY-vertailu: z = 1 − 2(n − 0,5)/N riippuu aineiston koosta. Pisteet siirtyvät, jos N muuttuu. Älä käytä
            tuloksiin.
          </div>
        )}
      </div>
      <div className="view-hint">
        {fmtN(visibleCount)} osumaa näkyvissä · pyöritä yhdellä sormella, zoomaa kahdella · napauta pistettä
      </div>
    </div>
  );
}
