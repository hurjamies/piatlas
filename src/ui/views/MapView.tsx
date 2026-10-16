import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FIB, fibNeighbors, localParastichyK } from '../../core/fibonacci';
import { faceBits, faceRelation, mapIndex, Vec2, vogel } from '../../core/mapping';
import { atlasLayout, Layout, netLayout, placeOnLayout } from '../../core/net';
import { fitView, PickItem, pickNearest, View2D, worldToScreen } from '../../core/pick';
import { nearestIndex } from '../../core/search';
import { SearchTerm } from '../../core/types';
import { select, setMapMode } from '../../state/actions';
import { useCompanions } from '../../state/derived';
import { useApp } from '../../state/store';
import { PanZoomCanvas, PanZoomHandle } from '../components/PanZoomCanvas';
import { fmtN } from '../format';

const DIGIT_COLORS = Array.from({ length: 10 }, (_, d) => `hsl(${(d * 36 + 190) % 360} 45% 62%)`);

function sizeFor(count: number) {
  if (count <= 40) return 6;
  if (count <= 400) return 4;
  if (count <= 3000) return 2.6;
  return 1.8;
}


const posCache = new WeakMap<Int32Array, Float64Array>();
function spiralPositions(h: Int32Array): Float64Array {
  let a = posCache.get(h);
  if (!a) {
    a = new Float64Array(h.length * 2);
    for (let i = 0; i < h.length; i++) {
      const p = vogel(h[i]);
      a[2 * i] = p.x;
      a[2 * i + 1] = p.y;
    }
    posCache.set(h, a);
  }
  return a;
}

function ringAt(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, w = 2) {
  if (offCanvas(g, x, y)) return;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
}

function offCanvas(g: CanvasRenderingContext2D, x: number, y: number) {
  const k = Math.min(window.devicePixelRatio || 1, 2);
  return x < -20 || y < -20 || x > g.canvas.width / k + 20 || y > g.canvas.height / k + 20;
}

/** Tällä piirtokerralla jo piirretyt nimilaput (päällekkäisyyksien välttämiseen). */
let placedLabels: { x: number; y: number; w: number; h: number }[] = [];
function resetLabels() {
  placedLabels = [];
}

function label(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  if (offCanvas(g, x, y)) return; // vain näkyvissä olevat osumat saavat nimilapun
  g.font = '500 11.5px "IBM Plex Mono", ui-monospace, monospace';
  const w = g.measureText(text).width + 12;
  g.fillStyle = 'rgba(7,11,20,0.85)';
  g.strokeStyle = color + '99';
  g.lineWidth = 1;
  // pidä nimilappu kankaan sisällä
  const cw = g.canvas.width / Math.min(window.devicePixelRatio || 1, 2);
  x = Math.min(cw - w / 2 - 4, Math.max(w / 2 + 4, x));
  const bx = x - w / 2;
  let by = Math.max(4, y - 30);
  // siirrä ylös, jos lappu osuisi aiemmin piirrettyyn
  for (let guard = 0; guard < 6; guard++) {
    const hit = placedLabels.find((b) => bx < b.x + b.w && bx + w > b.x && by < b.y + b.h && by + 19 > b.y);
    if (!hit) break;
    by = hit.y - 22;
  }
  placedLabels.push({ x: bx, y: by, w, h: 19 });
  if (by + 19 < y - 12) {
    g.beginPath();
    g.moveTo(x, by + 19);
    g.lineTo(x, y - 10);
    g.stroke();
  }
  g.beginPath();
  g.roundRect(bx, by, w, 19, 7);
  g.fill();
  g.stroke();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, by + 10);
}

export function MapView() {
  const mode = useApp((s) => s.mapMode);
  const [portrait, setPortrait] = useState(() => window.innerWidth < window.innerHeight);
  useEffect(() => {
    const f = () => setPortrait(window.innerWidth < window.innerHeight);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return (
    <div className="view" data-testid="map-view">
      {mode === 'spiral' ? <SpiralMap /> : <LayoutMap kind={mode} portrait={portrait} />}
      <div className="overlay-top">
        <div className="seg" role="group" aria-label="Karttatyyppi">
          <button aria-pressed={mode === 'spiral'} onClick={() => setMapMode('spiral')}>
            Spiraali
          </button>
          <button aria-pressed={mode === 'atlas'} onClick={() => setMapMode('atlas')}>
            8 kolmiota
          </button>
          <button aria-pressed={mode === 'net'} onClick={() => setMapMode('net')}>
            Avattu verkko
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ spiraali

function SpiralMap() {
  const terms = useApp((s) => s.terms);
  const hits = useApp((s) => s.hits);
  const anchor = useApp((s) => s.anchor);
  const selection = useApp((s) => s.selection);
  const digits = useApp((s) => s.digits);
  const companions = useCompanions();
  const showPath = useApp((s) => s.prefs.showPath);
  const N = digits.length;
  const ref = useRef<PanZoomHandle>(null);
  const [fibSpan, setFibSpan] = useState<'local' | 'all'>('local');
  const [showDigits, setShowDigits] = useState(true);

  const sample = useMemo(() => {
    const M = Math.min(40000, N);
    const a = new Float64Array(M * 2);
    const nn = new Int32Array(M);
    for (let i = 0; i < M; i++) {
      const n = 1 + Math.floor((i * (N - 1)) / Math.max(1, M - 1));
      const p = vogel(n);
      a[2 * i] = p.x;
      a[2 * i + 1] = p.y;
      nn[i] = n;
    }
    return { a, nn };
  }, [N]);

  const visTerms = useMemo(() => terms.filter((t) => t.visible), [terms]);
  const sel = selection ?? { termId: anchor.termId, n: anchor.n };
  const fibList = useMemo(() => {
    const k0 = localParastichyK(sel.n);
    const [lo, hi] = fibSpan === 'local' ? [Math.max(2, k0 - 3), k0 + 2] : [2, 40];
    return fibNeighbors(sel.n, N, lo, hi);
  }, [sel.n, N, fibSpan]);

  const hitAt = useCallback(
    (n: number): SearchTerm | null => {
      for (const t of visTerms) {
        const h = hits[t.id];
        if (!h || h.status !== 'ready') continue;
        const i = nearestIndex(h.hits, n);
        if (i >= 0 && h.hits[i] === n) return t;
      }
      return null;
    },
    [visTerms, hits],
  );

  const draw = useCallback(
    (g: CanvasRenderingContext2D, v: View2D) => {
      resetLabels();
      g.fillStyle = '#070b14';
      g.fillRect(0, 0, v.width, v.height);
      const R = Math.sqrt(N);
      // ulkoreuna = aineiston loppu
      const o = worldToScreen(v, 0, 0);
      g.beginPath();
      g.arc(o.sx, o.sy, R * v.scale, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,181,71,0.35)';
      g.setLineDash([4, 5]);
      g.lineWidth = 1;
      g.stroke();
      g.setLineDash([]);
      // taustapisteet: tiheä tila tai näyte
      const wx0 = v.cx - v.width / 2 / v.scale, wx1 = v.cx + v.width / 2 / v.scale;
      const wy0 = v.cy - v.height / 2 / v.scale, wy1 = v.cy + v.height / 2 / v.scale;
      const nx = Math.max(wx0, Math.min(0, wx1)), ny = Math.max(wy0, Math.min(0, wy1));
      const rmin = Math.hypot(nx, ny);
      const rmax = Math.max(Math.hypot(wx0, wy0), Math.hypot(wx1, wy0), Math.hypot(wx0, wy1), Math.hypot(wx1, wy1));
      const nLo = Math.max(1, Math.floor(rmin * rmin));
      const nHi = Math.min(N, Math.ceil(rmax * rmax));
      const dense = nHi - nLo < 260_000;
      if (dense) {
        const numerals = showDigits && v.scale >= 15;
        if (numerals) {
          g.font = `${Math.min(15, v.scale * 0.55)}px "IBM Plex Mono", ui-monospace, monospace`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
        }
        for (let n = nLo; n <= nHi; n++) {
          const p = vogel(n);
          if (p.x < wx0 || p.x > wx1 || p.y < wy0 || p.y > wy1) continue;
          const s = worldToScreen(v, p.x, p.y);
          const d = digits.charCodeAt(n - 1) - 48;
          if (numerals) {
            g.fillStyle = DIGIT_COLORS[d];
            g.globalAlpha = 0.75;
            g.fillText(String(d), s.sx, s.sy);
          } else {
            g.fillStyle = showDigits ? DIGIT_COLORS[d] : '#8aa3b8';
            g.globalAlpha = 0.5;
            const r = Math.max(0.7, Math.min(2.2, v.scale * 0.22));
            g.fillRect(s.sx - r / 2, s.sy - r / 2, r, r);
          }
        }
        g.globalAlpha = 1;
      } else {
        g.fillStyle = '#8aa3b8';
        g.globalAlpha = 0.35;
        const a = sample.a;
        for (let i = 0; i < a.length / 2; i++) {
          const x = a[2 * i], y = a[2 * i + 1];
          if (x < wx0 || x > wx1 || y < wy0 || y > wy1) continue;
          const s = worldToScreen(v, x, y);
          g.fillRect(s.sx, s.sy, 1.2, 1.2);
        }
        g.globalAlpha = 1;
      }
      // Fibonacci-naapurit valitulle osumalle
      const sp = vogel(sel.n);
      const ss = worldToScreen(v, sp.x, sp.y);
      g.font = '10.5px "IBM Plex Mono", ui-monospace, monospace';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      for (const f of fibList) {
        for (const m of [f.minus, f.plus]) {
          if (m == null) continue;
          const p = vogel(m);
          const s = worldToScreen(v, p.x, p.y);
          if (s.sx < -50 || s.sy < -50 || s.sx > v.width + 50 || s.sy > v.height + 50) continue;
          const t = hitAt(m);
          g.strokeStyle = 'rgba(114,225,209,0.45)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(ss.sx, ss.sy);
          g.lineTo(s.sx, s.sy);
          g.stroke();
          g.beginPath();
          g.rect(s.sx - 4, s.sy - 4, 8, 8);
          if (t) {
            g.fillStyle = t.color;
            g.fill();
          } else {
            g.strokeStyle = '#72e1d1';
            g.stroke();
          }
          g.fillStyle = t ? t.color : '#9fd9cf';
          g.fillText(`${m > sel.n ? '+' : '−'}F${f.k}${t ? ' ' + t.label : ''}`, s.sx + 7, s.sy);
        }
      }
      // osumat
      const ordered = [...visTerms].sort((a, b) => (hits[b.id]?.count ?? 0) - (hits[a.id]?.count ?? 0));
      for (const t of ordered) {
        const h = hits[t.id];
        if (!h || h.status !== 'ready') continue;
        const pos = spiralPositions(h.hits);
        const r = sizeFor(h.count);
        g.fillStyle = t.color;
        for (let i = 0; i < h.hits.length; i++) {
          const x = pos[2 * i], y = pos[2 * i + 1];
          if (x < wx0 - 1 || x > wx1 + 1 || y < wy0 - 1 || y > wy1 + 1) continue;
          const s = worldToScreen(v, x, y);
          g.beginPath();
          g.arc(s.sx, s.sy, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      // valitun osuman merkkipolku: peräkkäiset numerot kääntyvät 137,5°, joten polku on himmeä katkoviiva
      const st = terms.find((t) => t.id === sel.termId);
      const sh = hits[sel.termId];
      if (st && sh && showPath && sh.code.length > 1) {
        const step = st.mode === 'fibSkip' ? FIB[st.fibK ?? 10] : 1;
        const pts = Array.from({ length: Math.min(sh.code.length, 30) }, (_, i) => {
          const p = vogel(sel.n + i * step);
          return worldToScreen(v, p.x, p.y);
        });
        g.strokeStyle = st.color;
        g.globalAlpha = 0.45;
        g.lineWidth = 1;
        g.setLineDash([3, 4]);
        g.beginPath();
        pts.forEach((s, i) => (i ? g.lineTo(s.sx, s.sy) : g.moveTo(s.sx, s.sy)));
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
        g.font = '600 10px "IBM Plex Mono", ui-monospace, monospace';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        pts.forEach((s, i) => {
          if (i === 0) return;
          g.fillStyle = 'rgba(7,11,20,0.9)';
          g.beginPath();
          g.arc(s.sx, s.sy, 7, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = st.color;
          g.lineWidth = 1;
          g.stroke();
          g.fillStyle = st.color;
          g.fillText(String(i + 1), s.sx, s.sy + 0.5);
        });
      }
      // renkaat ja nimilaput
      for (const c of companions) {
        const t = terms.find((x) => x.id === c.termId);
        if (!t) continue;
        const p = vogel(c.n);
        const s = worldToScreen(v, p.x, p.y);
        ringAt(g, s.sx, s.sy, 9, t.color);
        label(g, s.sx, s.sy, `${t.label} · ${fmtN(c.n)}`, t.color);
      }
      const at = terms.find((t) => t.id === anchor.termId);
      if (at) {
        const p = vogel(anchor.n);
        const s = worldToScreen(v, p.x, p.y);
        ringAt(g, s.sx, s.sy, 12, at.color, 2.5);
        label(g, s.sx, s.sy - 4, `⚓ ${at.label} · ${fmtN(anchor.n)}`, at.color);
      }
      if (selection && st && !(selection.termId === anchor.termId && selection.n === anchor.n)) {
        ringAt(g, ss.sx, ss.sy, 14, '#ffffff', 2);
        if (!companions.some((c) => c.termId === selection.termId && c.n === selection.n))
          label(g, ss.sx, ss.sy - 6, `${st.label} · ${fmtN(selection.n)}`, '#ffffff');
      }
    },
    [N, digits, sample, fibList, visTerms, hits, terms, sel.n, sel.termId, selection, anchor, companions, hitAt, showDigits, showPath],
  );

  // Oletuksena koko spiraali: ankkuri ja kumppaniosumat näkyvät nimilappuineen.
  const fit = useCallback(
    (w: number, h: number): View2D => {
      const scale = Math.min(w - 24, h - 190) / (2 * Math.sqrt(N) + 60);
      return { cx: 0, cy: -40 / scale, scale, width: w, height: h };
    },
    [N],
  );

  const onTap = useCallback(
    (sx: number, sy: number, v: View2D) => {
      const items: PickItem[] = [];
      for (const t of visTerms) {
        const h = hits[t.id];
        if (!h || h.status !== 'ready') continue;
        const pos = spiralPositions(h.hits);
        const r = sizeFor(h.count);
        for (let i = 0; i < h.hits.length; i++) {
          const s = worldToScreen(v, pos[2 * i], pos[2 * i + 1]);
          if (Math.abs(s.sx - sx) > 40 || Math.abs(s.sy - sy) > 40) continue;
          items.push({ termId: t.id, n: h.hits[i], sx: s.sx, sy: s.sy, r });
        }
      }
      const best = pickNearest(items, sx, sy, 22);
      if (best) select({ termId: best.termId, n: best.n });
    },
    [visTerms, hits],
  );

  useEffect(() => {
    // Testikoukku (e2e): osuman näyttökoordinaatit spiraalissa.
    (window as unknown as Record<string, unknown>).__piatlasMap = {
      screenOf: (n: number) => {
        const v = ref.current?.getView();
        if (!v) return null;
        const p = vogel(n);
        const s = worldToScreen(v, p.x, p.y);
        return { x: s.sx, y: s.sy };
      },
    };
  }, []);

  const goTo = (n: number, scale?: number) => {
    const p = vogel(n);
    ref.current?.setView({ cx: p.x, cy: p.y, ...(scale ? { scale } : {}) });
  };

  useEffect(() => {
    if (selection) {
      const v = ref.current?.getView();
      if (!v) return;
      const p = vogel(selection.n);
      const s = worldToScreen(v, p.x, p.y);
      if (s.sx < 30 || s.sy < 80 || s.sx > v.width - 30 || s.sy > v.height - 110) goTo(selection.n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.n, selection?.termId]);

  return (
    <>
      <PanZoomCanvas ref={ref} draw={draw} fit={fit} onTap={onTap} deps={[draw]} minScale={0.15} maxScale={80} testId="spiral-canvas" />
      <div className="overlay-top" style={{ top: 54 }}>
        <button className="toggle" onClick={() => ref.current?.fit()}>
          Koko spiraali
        </button>
        <button className="toggle" onClick={() => goTo(anchor.n, 7)}>
          Ankkuriin
        </button>
        <button className="toggle" onClick={() => goTo(sel.n, 14)}>
          Valittuun
        </button>
        <button className="toggle" onClick={() => goTo(sel.n, 30)}>
          Numerot näkyviin
        </button>
        <button className="toggle" aria-pressed={showDigits} onClick={() => setShowDigits(!showDigits)}>
          <span className="dot" /> Väri = numero
        </button>
        <button className="toggle" aria-pressed={fibSpan === 'all'} onClick={() => setFibSpan(fibSpan === 'all' ? 'local' : 'all')}>
          <span className="dot" /> Kaikki F_k
        </button>
      </div>
      <div className="view-hint">
        θ = n·137,508°, r = √n. Neliöt = indeksit n ± F_k (paikkoja, eivät osumia; täytetty neliö = osuman alku). Katkoviiva
        = aineiston loppu.
      </div>
    </>
  );
}

// ------------------------------------------------------------------ 8 kolmion atlas ja avattu verkko

const FACE_FILL = ['#13324a', '#14324a', '#123047', '#152f48', '#0f2236', '#102438', '#0f2134', '#112336'];

function LayoutMap({ kind, portrait }: { kind: 'atlas' | 'net'; portrait: boolean }) {
  const terms = useApp((s) => s.terms);
  const hits = useApp((s) => s.hits);
  const anchor = useApp((s) => s.anchor);
  const selection = useApp((s) => s.selection);
  const digits = useApp((s) => s.digits);
  const companions = useCompanions();
  const N = digits.length;
  const ref = useRef<PanZoomHandle>(null);
  const layout: Layout = useMemo(
    () => (kind === 'atlas' ? atlasLayout(portrait ? 2 : 4) : netLayout(portrait)),
    [kind, portrait],
  );
  const visTerms = useMemo(() => terms.filter((t) => t.visible), [terms]);

  const sample = useMemo(() => {
    const M = Math.min(24000, N);
    const a = new Float64Array(M * 2);
    for (let i = 0; i < M; i++) {
      const n = 1 + Math.floor((i * (N - 1)) / Math.max(1, M - 1));
      const q = placeOnLayout(layout, mapIndex(n));
      a[2 * i] = q.x;
      a[2 * i + 1] = q.y;
    }
    return a;
  }, [N, layout]);

  const termPos = useMemo(() => {
    const m = new Map<string, Float64Array>();
    for (const t of visTerms) {
      const h = hits[t.id];
      if (!h || h.status !== 'ready') continue;
      const a = new Float64Array(h.hits.length * 2);
      for (let i = 0; i < h.hits.length; i++) {
        const q = placeOnLayout(layout, mapIndex(h.hits[i]));
        a[2 * i] = q.x;
        a[2 * i + 1] = q.y;
      }
      m.set(t.id, a);
    }
    return m;
  }, [visTerms, hits, layout]);

  const faceCounts = useMemo(() => {
    const c = new Array(8).fill(0);
    for (const t of visTerms) {
      const h = hits[t.id];
      if (!h || h.status !== 'ready') continue;
      for (let i = 0; i < h.hits.length; i++) c[faceBits(mapIndex(h.hits[i]))]++;
    }
    return c;
  }, [visTerms, hits]);

  const selFace = selection ? faceBits(mapIndex(selection.n)) : null;
  const anchorFace = faceBits(mapIndex(anchor.n));

  const draw = useCallback(
    (g: CanvasRenderingContext2D, v: View2D) => {
      resetLabels();
      g.fillStyle = '#070b14';
      g.fillRect(0, 0, v.width, v.height);
      const S = (p: Vec2) => worldToScreen(v, p.x, p.y);
      // kolmiot
      for (const f of layout.faces) {
        const a = S(f.X), b = S(f.Y), c = S(f.Z);
        g.beginPath();
        g.moveTo(a.sx, a.sy);
        g.lineTo(b.sx, b.sy);
        g.lineTo(c.sx, c.sy);
        g.closePath();
        let fill = FACE_FILL[f.bits];
        if (selFace != null && f.bits === selFace) fill = '#1d4a5a';
        else if (selFace != null && faceRelation(selFace, f.bits) === 'reunanaapuri') fill = '#163a4c';
        g.fillStyle = fill;
        g.fill();
      }
      // särmät
      for (const e of layout.edges) {
        const a = S(e.a), b = S(e.b);
        g.beginPath();
        g.moveTo(a.sx, a.sy);
        g.lineTo(b.sx, b.sy);
        g.strokeStyle = e.kind === 'fold' ? 'rgba(118,161,169,0.55)' : 'rgba(118,161,169,0.95)';
        g.lineWidth = e.kind === 'fold' ? 1 : 1.4;
        g.setLineDash(e.kind === 'fold' ? [4, 4] : []);
        g.stroke();
        g.setLineDash([]);
        if (e.label) {
          const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
          const f = layout.faces[e.face];
          const c = S(f.centroid);
          const dx = mx - c.sx, dy = my - c.sy;
          const L = Math.hypot(dx, dy) || 1;
          g.font = '600 12px "IBM Plex Mono", ui-monospace, monospace';
          g.fillStyle = '#ffb547';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(e.label, mx + (dx / L) * 11, my + (dy / L) * 11);
        }
      }
      // näytepisteet
      g.fillStyle = '#8aa3b8';
      g.globalAlpha = 0.28;
      for (let i = 0; i < sample.length / 2; i++) {
        const s = worldToScreen(v, sample[2 * i], sample[2 * i + 1]);
        g.fillRect(s.sx, s.sy, 1.1, 1.1);
      }
      g.globalAlpha = 1;
      // osumat
      const ordered = [...visTerms].sort((a, b) => (hits[b.id]?.count ?? 0) - (hits[a.id]?.count ?? 0));
      for (const t of ordered) {
        const pos = termPos.get(t.id);
        const h = hits[t.id];
        if (!pos || !h) continue;
        const r = sizeFor(h.count);
        g.fillStyle = t.color;
        for (let i = 0; i < pos.length / 2; i++) {
          const s = worldToScreen(v, pos[2 * i], pos[2 * i + 1]);
          g.beginPath();
          g.arc(s.sx, s.sy, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      // pintojen nimet
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const f of layout.faces) {
        const c = S(f.centroid);
        g.fillStyle = 'rgba(7,11,20,0.78)';
        g.beginPath();
        g.roundRect(c.sx - 34, c.sy - 16, 68, 31, 8);
        g.fill();
        g.font = '600 12px "IBM Plex Sans", system-ui, sans-serif';
        g.fillStyle = f.bits === anchorFace ? '#72e1d1' : 'rgba(230,238,243,0.9)';
        g.fillText(f.name.split(' ')[0], c.sx, c.sy - 7);
        g.font = '10.5px "IBM Plex Mono", ui-monospace, monospace';
        g.fillStyle = 'rgba(168,188,203,0.85)';
        g.fillText(`${f.name.split(' ')[1]} · ${fmtN(faceCounts[f.bits])}`, c.sx, c.sy + 8);
      }
      // kärjet
      g.font = '10.5px "IBM Plex Sans", system-ui, sans-serif';
      g.fillStyle = 'rgba(168,188,203,0.75)';
      const seenV: { x: number; y: number; id: string }[] = [];
      for (const vx of layout.vertices) {
        const s = S(vx.pos);
        if (seenV.some((q) => q.id === vx.id && Math.hypot(q.x - s.sx, q.y - s.sy) < 24)) continue;
        seenV.push({ x: s.sx, y: s.sy, id: vx.id });
        const f0 = layout.faces.find((f) => f.X === vx.pos || f.Y === vx.pos || f.Z === vx.pos);
        // atlas: ulospäin oman vinoneliön keskeltä, verkko: ulospäin oman kolmion keskeltä
        let c = f0 ? S(f0.centroid) : s;
        if (layout.kind === 'atlas' && f0) {
          const pair = layout.faces[f0.bits ^ 4];
          const a = S(f0.centroid), b = S(pair.centroid);
          c = { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 };
        }
        const dx = s.sx - c.sx, dy = s.sy - c.sy;
        const L = Math.hypot(dx, dy) || 1;
        g.fillText(vx.id.replace('-', '−'), s.sx + (dx / L) * 11, s.sy + (dy / L) * 11);
      }
      // merkit
      const place = (n: number) => {
        const q = placeOnLayout(layout, mapIndex(n));
        return worldToScreen(v, q.x, q.y);
      };
      for (const c of companions) {
        const t = terms.find((x) => x.id === c.termId);
        if (!t) continue;
        const s = place(c.n);
        ringAt(g, s.sx, s.sy, 8, t.color);
        label(g, s.sx, s.sy, `${t.label} · ${fmtN(c.n)}`, t.color);
      }
      const at = terms.find((t) => t.id === anchor.termId);
      if (at) {
        const s = place(anchor.n);
        ringAt(g, s.sx, s.sy, 11, at.color, 2.5);
        label(g, s.sx, s.sy - 3, `⚓ ${at.label} · ${fmtN(anchor.n)}`, at.color);
      }
      if (selection && !(selection.termId === anchor.termId && selection.n === anchor.n)) {
        const st = terms.find((t) => t.id === selection.termId);
        const s = place(selection.n);
        ringAt(g, s.sx, s.sy, 13, '#ffffff', 2);
        if (st && !companions.some((c) => c.termId === selection.termId && c.n === selection.n))
          label(g, s.sx, s.sy - 5, `${st.label} · ${fmtN(selection.n)}`, '#ffffff');
      }
    },
    [layout, sample, visTerms, hits, termPos, terms, anchor, selection, companions, selFace, anchorFace, faceCounts],
  );

  const fit = useCallback((w: number, h: number) => fitView(layout.bbox, w, h - 150, 22), [layout]);
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__piatlasMap = {
      screenOf: (n: number) => {
        const v = ref.current?.getView();
        if (!v) return null;
        const q = placeOnLayout(layout, mapIndex(n));
        const s = worldToScreen(v, q.x, q.y);
        return { x: s.sx, y: s.sy + 48 };
      },
    };
  }, [layout]);
  useEffect(() => {
    const v = ref.current?.getView();
    if (v) ref.current?.setView({ ...fitView(layout.bbox, v.width, v.height - 150, 22) });
  }, [layout]);

  const onTap = useCallback(
    (sx: number, sy: number, v: View2D) => {
      const items: PickItem[] = [];
      for (const t of visTerms) {
        const pos = termPos.get(t.id);
        const h = hits[t.id];
        if (!pos || !h) continue;
        const r = sizeFor(h.count);
        for (let i = 0; i < pos.length / 2; i++) {
          const s = worldToScreen(v, pos[2 * i], pos[2 * i + 1]);
          if (Math.abs(s.sx - sx) > 40 || Math.abs(s.sy - sy) > 40) continue;
          items.push({ termId: t.id, n: h.hits[i], sx: s.sx, sy: s.sy, r });
        }
      }
      const best = pickNearest(items, sx, sy, 22);
      if (best) select({ termId: best.termId, n: best.n });
    },
    [visTerms, termPos, hits],
  );

  return (
    <>
      <div style={{ position: 'absolute', inset: '48px 0 0 0' }}>
        <PanZoomCanvas ref={ref} draw={draw} fit={fit} onTap={onTap} deps={[draw]} minScale={10} maxScale={20000} testId="layout-canvas" />
      </div>
      <div className="view-hint">
        {kind === 'atlas'
          ? 'Kahdeksan erillistä kolmiota. Kvadrantin ylä- (z+) ja alapinta (z−) ovat vastakkain yhteisen X–Y-särmän kautta. Piste = barysentriset (|x|,|y|,|z|).'
          : 'Avattu oktaedri: katkoviiva = taitos, yhtenäinen = leikkaus. Sama kirjain = sama 3D-särmä. Vaalea pinta = valitun pinta ja sen reunanaapurit.'}
      </div>
    </>
  );
}
