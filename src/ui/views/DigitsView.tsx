import { useMemo, useState } from 'react';
import { digitsAt, sliceContext } from '../../core/digits';
import { FIB } from '../../core/fibonacci';
import { lowerBound } from '../../core/search';
import { SearchTerm } from '../../core/types';
import { focusIndex, select, selectAnchor, setPrefs } from '../../state/actions';
import { TermHits, useApp } from '../../state/store';
import { fmtN, fmtSigned } from '../format';
import { HitDetails } from '../components/HitDetails';
import { Timelines } from '../components/Timelines';
import { useWidth } from '../components/useWidth';

interface Mark {
  termId: string;
  color: string;
  primary: boolean;
}

function hitsInRange(h: TermHits | undefined, lo: number, hi: number): number[] {
  if (!h || h.status !== 'ready') return [];
  const out: number[] = [];
  for (let i = lowerBound(h.hits, lo); i < h.hits.length && h.hits[i] <= hi; i++) out.push(h.hits[i]);
  return out;
}

export function DigitsView() {
  const digits = useApp((s) => s.digits);
  const sel = useApp((s) => s.selection);
  const focusN = useApp((s) => s.focusN);
  const anchor = useApp((s) => s.anchor);
  const terms = useApp((s) => s.terms);
  const hits = useApp((s) => s.hits);
  const width = useApp((s) => s.prefs.contextWidth);
  const [jump, setJump] = useState('');
  const [lineW, setLineW] = useState(1000);
  const N = digits.length;

  const target = sel?.n ?? focusN ?? anchor.n;
  const selTerm = sel ? terms.find((t) => t.id === sel.termId) : undefined;
  const selH = sel ? hits[sel.termId] : undefined;
  const step = selTerm?.mode === 'fibSkip' ? FIB[selTerm.fibK ?? 10] : 1;
  const L = selH?.code.length ?? 1;
  const span = (L - 1) * step + 1;

  const ctx = useMemo(() => sliceContext(digits, target, sel ? Math.min(span, 400) : 1, width, width), [digits, target, span, width, sel]);

  const marks = useMemo(() => {
    const m = new Map<number, Mark>();
    if (sel && selTerm) for (let i = 0; i < L; i++) m.set(sel.n + i * step, { termId: sel.termId, color: selTerm.color, primary: true });
    for (const t of terms) {
      if (!t.visible || t.mode === 'fibSkip') continue;
      const h = hits[t.id];
      const len = h?.code.length ?? 0;
      for (const n of hitsInRange(h, ctx.start - len + 1, ctx.end)) {
        for (let k = 0; k < len; k++) if (!m.has(n + k)) m.set(n + k, { termId: t.id, color: t.color, primary: false });
      }
    }
    return m;
  }, [sel, selTerm, L, step, terms, hits, ctx.start, ctx.end]);

  const rows = useMemo(() => {
    const out: { start: number; cells: { idx: number; d: string }[] }[] = [];
    const first = ctx.start - ((ctx.start - 1) % 10);
    for (let r = first; r <= ctx.end; r += 10) {
      const cells: { idx: number; d: string }[] = [];
      for (let k = 0; k < 10; k++) {
        const idx = r + k;
        cells.push({ idx, d: idx >= ctx.start && idx <= ctx.end ? digits[idx - 1] : ' ' });
      }
      out.push({ start: r, cells });
    }
    return out;
  }, [ctx, digits]);

  const local = useMemo(() => {
    const lo = Math.max(1, target - lineW);
    const hi = Math.min(N, target + lineW);
    const items: { t: SearchTerm; n: number }[] = [];
    for (const t of terms) {
      if (!t.visible) continue;
      for (const n of hitsInRange(hits[t.id], lo, hi)) items.push({ t, n });
    }
    items.sort((a, b) => a.n - b.n);
    return { lo, hi, items };
  }, [terms, hits, target, lineW, N]);

  if (!N) return <div className="page muted">Aineistoa ladataan…</div>;

  const actual = sel && selH ? (step === 1 ? digitsAt(digits, sel.n, L) : '') : '';

  return (
    <div className="view scroll" data-testid="digits-view">
      <div className="page">
        <div className="section">
          <div className="eyebrow">Alkuperäinen 1D-numerolinja</div>
          <h2 className="h2">
            {sel && selTerm ? (
              <>
                {selTerm.label} <span className="mono muted" style={{ fontSize: 16 }}>{selH?.code}</span> @{fmtN(sel.n)}
              </>
            ) : (
              <>Desimaali {fmtN(target)}</>
            )}
          </h2>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(jump.replace(/\s/g, ''));
              if (Number.isInteger(v) && v >= 1 && v <= N) focusIndex(v);
            }}
          >
            <input
              id="jump-index"
              className="input"
              style={{ maxWidth: 170 }}
              inputMode="numeric"
              placeholder={`1…${fmtN(N)}`}
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              aria-label="Siirry desimaali-indeksiin"
            />
            <button className="btn small" type="submit">
              Siirry
            </button>
            <button className="btn small ghost" type="button" onClick={() => selectAnchor()}>
              Ankkuriin
            </button>
            <select
              className="input"
              style={{ maxWidth: 140 }}
              aria-label="Leikkeen leveys"
              value={width}
              onChange={(e) => setPrefs({ contextWidth: Number(e.target.value) })}
            >
              <option value={30}>±30 numeroa</option>
              <option value={60}>±60 numeroa</option>
              <option value={150}>±150 numeroa</option>
              <option value={300}>±300 numeroa</option>
            </select>
          </form>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div className="digits-grid" role="table" aria-label="Piin desimaalit 1-pohjaisin indeksein">
            {ctx.atStart && (
              <>
                <span className="idx" />
                <span className="end">3, ← aineiston alku (desimaali 1 = "1")</span>
              </>
            )}
            {rows.map((r) => (
              <RowView key={r.start} start={r.start} cells={r.cells} marks={marks} onPick={(idx) => {
                const m = marks.get(idx);
                if (m) {
                  const h = hits[m.termId];
                  const len = h?.code.length ?? 1;
                  const startN = hitsInRange(h, idx - len + 1, idx)[0];
                  if (startN != null) select({ termId: m.termId, n: startN });
                }
              }} />
            ))}
            {ctx.atEnd && (
              <>
                <span className="idx" />
                <span className="end">aineiston loppu: desimaali {fmtN(N)} on viimeinen ladattu numero</span>
              </>
            )}
          </div>
          {sel && selH && step === 1 && (
            <div className={`verify ${actual === selH.code ? '' : 'bad'}`} style={{ marginTop: 12 }}>
              <span className="mark">{actual === selH.code ? '✓' : '✕'}</span>
              <span>
                Desimaalit {fmtN(sel.n)}–{fmtN(sel.n + L - 1)} lähdetiedostossa: <b className="mono">{actual}</b>. Indeksi on
                1-pohjainen: desimaali 1 on piin ensimmäinen desimaali (3,<b>1</b>4159…). Rivin alussa oleva luku on
                rivin ensimmäisen numeron indeksi.
              </span>
            </div>
          )}
        </div>

        <div className="section">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="eyebrow">Lähiosumat numerolinjalla</div>
            <select className="input" style={{ maxWidth: 150 }} aria-label="Numerolinjan ikkuna" value={lineW} onChange={(e) => setLineW(Number(e.target.value))}>
              <option value={300}>±300</option>
              <option value={1000}>±1 000</option>
              <option value={5000}>±5 000</option>
              <option value={20000}>±20 000</option>
            </select>
          </div>
          <LocalLine lo={local.lo} hi={local.hi} target={target} items={local.items} anchorN={anchor.n} sel={sel} />
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Osuma</th>
                  <th className="r">n</th>
                  <th className="r">Δn kohteesta</th>
                  <th className="r">Δn ankkurista</th>
                </tr>
              </thead>
              <tbody>
                {local.items.slice(0, 80).map(({ t, n }) => (
                  <tr
                    key={`${t.id}@${n}`}
                    className={`clickable ${sel?.termId === t.id && sel.n === n ? 'sel' : ''}`}
                    onClick={() => select({ termId: t.id, n })}
                  >
                    <td>
                      <span className="swatch" style={{ background: t.color, marginRight: 6 }} />
                      {t.label} <span className="faint mono">{hits[t.id]?.code}</span>
                    </td>
                    <td className="r mono">{fmtN(n)}</td>
                    <td className="r mono">{fmtSigned(n - target)}</td>
                    <td className="r mono">{fmtSigned(n - anchor.n)}</td>
                  </tr>
                ))}
                {local.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="faint">
                      Ei näkyvien termien osumia tällä välillä.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {local.items.length > 80 && <div className="faint">Näytetään 80 / {local.items.length}. Kavenna ikkunaa.</div>}
        </div>

        <GlobalLine N={N} target={target} />

        {sel && (
          <div className="section">
            <div className="eyebrow">Osuman tiedot</div>
            <HitDetails termId={sel.termId} n={sel.n} />
          </div>
        )}

        <Timelines />
      </div>
    </div>
  );
}

function RowView({
  start,
  cells,
  marks,
  onPick,
}: {
  start: number;
  cells: { idx: number; d: string }[];
  marks: Map<number, Mark>;
  onPick: (idx: number) => void;
}) {
  return (
    <>
      <span className="idx">{fmtN(start)}</span>
      <span className="ds">
        {cells.map((c, k) => {
          const m = marks.get(c.idx);
          const style = m
            ? m.primary
              ? { background: m.color }
              : { textDecorationColor: m.color, color: m.color }
            : undefined;
          return (
            <span
              key={c.idx}
              className={`d ${m ? (m.primary ? 'hit' : 'other') : ''} ${k === 5 ? 'five' : ''}`}
              style={style}
              title={`desimaali ${c.idx}`}
              onClick={m ? () => onPick(c.idx) : undefined}
            >
              {c.d}
            </span>
          );
        })}
      </span>
    </>
  );
}

function LocalLine({
  lo,
  hi,
  target,
  items,
  anchorN,
  sel,
}: {
  lo: number;
  hi: number;
  target: number;
  items: { t: SearchTerm; n: number }[];
  anchorN: number;
  sel: { termId: string; n: number } | null;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 124;
  const x = (n: number) => 20 + ((n - lo) / Math.max(1, hi - lo)) * (W - 40);
  const rare = items.length <= 40;
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }} role="img" aria-label="Osumat numerolinjalla">
        <line className="axis" x1={20} x2={W - 20} y1={70} y2={70} />
        {(W < 520 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => {
          const n = Math.round(lo + f * (hi - lo));
          return (
            <g key={f}>
              <line className="grid" x1={x(n)} x2={x(n)} y1={64} y2={76} />
              <text x={x(n)} y={92} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
                {fmtN(n)}
              </text>
            </g>
          );
        })}
        {anchorN >= lo && anchorN <= hi && <line x1={x(anchorN)} x2={x(anchorN)} y1={20} y2={70} stroke="var(--teal)" strokeDasharray="3 3" />}
        <line x1={x(target)} x2={x(target)} y1={60} y2={80} stroke="var(--fg)" strokeWidth={2} />
        {items.map(({ t, n }, i) => {
          const isSel = sel?.termId === t.id && sel.n === n;
          return (
            <g key={`${t.id}@${n}`} style={{ cursor: 'pointer' }} onClick={() => select({ termId: t.id, n })}>
              <line x1={x(n)} x2={x(n)} y1={isSel ? 34 : 48} y2={70} stroke={t.color} strokeWidth={isSel ? 3 : 2} />
              <circle cx={x(n)} cy={isSel ? 34 : 48} r={isSel ? 6 : 4} fill={t.color} />
              <rect x={x(n) - 10} y={20} width={20} height={60} fill="transparent" />
              {rare && (
                <text x={x(n)} y={i % 2 ? 14 : 28} textAnchor="middle" style={{ fill: t.color }}>
                  {t.label}
                </text>
              )}
            </g>
          );
        })}
        <text x={W - 20} y={116} textAnchor="end">
          katkoviiva = ankkuri · valkoinen = kohde
        </text>
      </svg>
    </div>
  );
}

function GlobalLine({ N, target }: { N: number; target: number }) {
  const terms = useApp((s) => s.terms);
  const hits = useApp((s) => s.hits);
  const [ref, W] = useWidth<HTMLDivElement>();
  const vis = terms.filter((t) => t.visible && hits[t.id]?.status === 'ready');
  const rowH = 22;
  const H = 30 + vis.length * rowH + 26;
  const x = (n: number) => 20 + (n / N) * (W - 40);
  return (
    <div className="section">
      <div className="eyebrow">Koko aineisto 1…{fmtN(N)}</div>
      <div ref={ref} style={{ width: '100%' }}>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }} role="img" aria-label="Osumien sijainnit koko aineistossa">
          {vis.map((t, r) => {
            const h = hits[t.id]!;
            const y = 24 + r * rowH;
            // tiheys 200 lokeroon, jotta tuhannet osumat eivät piirry yksitellen
            const bins = new Array(200).fill(0);
            for (let i = 0; i < h.hits.length; i++) bins[Math.min(199, Math.floor((h.hits[i] / N) * 200))]++;
            const max = Math.max(1, ...bins);
            return (
              <g key={t.id}>
                <text x={20} y={y - 6}>
                  {t.label} · {fmtN(h.count)}
                </text>
                {h.count <= 300
                  ? Array.from(h.hits, (n) => <line key={n} x1={x(n)} x2={x(n)} y1={y - 2} y2={y + 8} stroke={t.color} strokeWidth={1.5} />)
                  : bins.map((b, i) => (
                      <rect key={i} x={20 + (i / 200) * (W - 40)} y={y + 8 - (b / max) * 10} width={(W - 40) / 200} height={(b / max) * 10} fill={t.color} opacity={0.75} />
                    ))}
              </g>
            );
          })}
          <line x1={x(target)} x2={x(target)} y1={12} y2={H - 22} stroke="var(--fg)" strokeDasharray="2 3" />
          <line className="axis" x1={20} x2={W - 20} y1={H - 22} y2={H - 22} />
          <text x={20} y={H - 6}>1</text>
          <text x={W - 20} y={H - 6} textAnchor="end">
            {fmtN(N)} (aineiston loppu)
          </text>
        </svg>
      </div>
    </div>
  );
}
