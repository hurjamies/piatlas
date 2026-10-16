import { useMemo, useState } from 'react';
import { faceName } from '../../core/mapping';
import { buildLinkGraph, hitPoint, HitPoint, NeighborFilter, NeighborRow, topNeighbors } from '../../core/neighbors';
import { select } from '../../state/actions';
import { useAllPool } from '../../state/derived';
import { useApp } from '../../state/store';
import { fmtD, fmtN, fmtSigned } from '../format';

const REL_SHORT: Record<string, string> = { sama: 'sama', reunanaapuri: 'särmä', kärkinaapuri: 'kärki', vastakkainen: 'vast.' };

const LINK_COLORS: Record<string, string> = {
  '1D': 'var(--gold)',
  '3D': 'var(--violet)',
  Fibonacci: 'var(--teal)',
  'sama pinta': 'var(--fg-3)',
};

export function NeighborsPanel() {
  const anchor = useApp((s) => s.anchor);
  const sel = useApp((s) => s.selection);
  const terms = useApp((s) => s.terms);
  const hits = useApp((s) => s.hits);
  const pool = useAllPool();
  const [center, setCenter] = useState<'anchor' | 'selected'>('anchor');
  const [onlyOthers, setOnlyOthers] = useState(true);
  const [termFilter, setTermFilter] = useState<string[] | null>(null);
  const [maxD1, setMaxD1] = useState<number | null>(null);
  const [maxD3, setMaxD3] = useState<number | null>(null);
  const [faces, setFaces] = useState<NeighborFilter['faces']>('all');
  const [maxLen, setMaxLen] = useState<number | null>(null);

  const c = center === 'selected' && sel ? sel : { termId: anchor.termId, n: anchor.n };
  const cLen = hits[c.termId]?.code.length ?? 1;
  const centerPt: HitPoint = useMemo(() => hitPoint(c.termId, c.n, cLen), [c.termId, c.n, cLen]);
  const filteredPool = useMemo(() => {
    const visibleIds = new Set(terms.filter((t) => t.visible).map((t) => t.id));
    return pool.filter(
      (h) => (termFilter ? termFilter.includes(h.termId) : visibleIds.has(h.termId)) && (maxLen == null || h.len <= maxLen),
    );
  }, [pool, terms, termFilter, maxLen]);
  const { by1, by3, total } = useMemo(
    () => topNeighbors(centerPt, filteredPool, 20, { excludeSameTerm: onlyOthers, maxD1, maxD3, faces }),
    [centerPt, filteredPool, onlyOthers, maxD1, maxD3, faces],
  );
  const termOf = (id: string) => terms.find((t) => t.id === id);
  const centerTerm = termOf(c.termId);

  return (
    <>
      <div className="seg" role="group" aria-label="Naapurien keskipiste">
        <button aria-pressed={center === 'anchor'} onClick={() => setCenter('anchor')}>
          Ankkuri {termOf(anchor.termId)?.label} @{fmtN(anchor.n)}
        </button>
        <button aria-pressed={center === 'selected'} onClick={() => setCenter('selected')} disabled={!sel}>
          Valittu osuma
        </button>
      </div>
      <div className="card section" style={{ gap: 10 }}>
        <div className="eyebrow">Suodattimet</div>
        <label className="check">
          <input type="checkbox" checked={onlyOthers} onChange={(e) => setOnlyOthers(e.target.checked)} /> Vain muut termit kuin{' '}
          {centerTerm?.label}
        </label>
        <div className="row">
          {terms.map((t) => {
            const on = termFilter ? termFilter.includes(t.id) : t.visible;
            return (
              <button
                key={t.id}
                className="toggle"
                aria-pressed={on}
                onClick={() => {
                  const base = termFilter ?? terms.filter((x) => x.visible).map((x) => x.id);
                  setTermFilter(on ? base.filter((x) => x !== t.id) : [...base, t.id]);
                }}
              >
                <span className="swatch" style={{ background: t.color }} /> {t.label}
              </button>
            );
          })}
        </div>
        <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="field">
            <span>MAKS. |Δn|</span>
            <select className="input" value={maxD1 ?? ''} onChange={(e) => setMaxD1(e.target.value ? Number(e.target.value) : null)}>
              <option value="">ei rajaa</option>
              <option value={1000}>1 000</option>
              <option value={10000}>10 000</option>
              <option value={100000}>100 000</option>
            </select>
          </label>
          <label className="field">
            <span>MAKS. 3D-SÄDE</span>
            <select className="input" value={maxD3 ?? ''} onChange={(e) => setMaxD3(e.target.value ? Number(e.target.value) : null)}>
              <option value="">ei rajaa</option>
              <option value={0.01}>0,01</option>
              <option value={0.05}>0,05</option>
              <option value={0.2}>0,2</option>
            </select>
          </label>
          <label className="field">
            <span>KOLMIOPINNAT</span>
            <select className="input" value={faces} onChange={(e) => setFaces(e.target.value as NeighborFilter['faces'])}>
              <option value="all">kaikki</option>
              <option value="same">sama pinta</option>
              <option value="same-or-edge">sama tai reunanaapuri</option>
            </select>
          </label>
          <label className="field">
            <span>HAUN PITUUS ≤</span>
            <select className="input" value={maxLen ?? ''} onChange={(e) => setMaxLen(e.target.value ? Number(e.target.value) : null)}>
              <option value="">kaikki</option>
              {[2, 3, 4, 5, 8, 10, 15].map((l) => (
                <option key={l} value={l}>
                  {l} numeroa
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>
          {fmtN(total)} osumaa suodatuksen jälkeen. Kohde: {faceName(centerPt.face)}.
        </div>
      </div>

      <NeighborTable title="Top 20 · 1D-indeksin mukaan" rows={by1} termOf={termOf} centerN={c.n} />
      <NeighborTable title="Top 20 · 3D-etäisyyden (chord) mukaan" rows={by3} termOf={termOf} centerN={c.n} />
      <LinkGraph center={centerPt} rows={[...by1.slice(0, 8), ...by3.slice(0, 8)]} termOf={termOf} />
      <div className="note">
        Läheisyys kartalla on <b>geometrinen yhteys</b> valitussa kartoituksessa, ei piin ominaisuus. Arvioi
        harvinaisuus Testit-välilehden nollamallilla.
      </div>
    </>
  );
}

function NeighborTable({
  title,
  rows,
  termOf,
  centerN,
}: {
  title: string;
  rows: NeighborRow[];
  centerN: number;
  termOf: (id: string) => { label: string; color: string } | undefined;
}) {
  const sel = useApp((s) => s.selection);
  return (
    <div className="section" style={{ gap: 6 }}>
      <div className="eyebrow">{title}</div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Osuma</th>
              <th className="r">Δn</th>
              <th>Fibonacci</th>
              <th className="r">3D</th>
              <th>Pinta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = termOf(r.hit.termId);
              const isSel = sel?.termId === r.hit.termId && sel.n === r.hit.n;
              return (
                <tr key={`${r.hit.termId}@${r.hit.n}`} className={`clickable ${isSel ? 'sel' : ''}`} onClick={() => select({ termId: r.hit.termId, n: r.hit.n })}>
                  <td>
                    <span className="swatch" style={{ background: t?.color, marginRight: 6 }} />
                    {t?.label} <span className="mono faint">@{fmtN(r.hit.n)}</span>
                  </td>
                  <td className="r mono">{fmtSigned(r.hit.n - centerN)}</td>
                  <td className="mono">{r.fibExactK != null ? <b style={{ color: 'var(--teal)' }}>= F{r.fibExactK}</b> : `F${r.fib.k}${r.fib.delta >= 0 ? '+' : '−'}${fmtN(Math.abs(r.fib.delta))}`}</td>
                  <td className="r mono">{fmtD(r.d3, 4)}</td>
                  <td>{REL_SHORT[r.relation]}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="faint">
                  Ei osumia suodattimilla.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinkGraph({
  center,
  rows,
  termOf,
}: {
  center: HitPoint;
  rows: NeighborRow[];
  termOf: (id: string) => { label: string; color: string } | undefined;
}) {
  const [maxD1, setMaxD1] = useState(1000);
  const [maxD3, setMaxD3] = useState(0.08);
  const nodes = useMemo(() => {
    const m = new Map<string, HitPoint>();
    m.set(`${center.termId}@${center.n}`, center);
    for (const r of rows) m.set(`${r.hit.termId}@${r.hit.n}`, r.hit);
    return [...m.values()];
  }, [center, rows]);
  const edges = useMemo(() => buildLinkGraph(nodes, { maxD1, maxD3 }), [nodes, maxD1, maxD3]);
  const W = 400;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const others = nodes.slice(1).sort((a, b) => a.n - b.n);
  const pos = new Map<HitPoint, { x: number; y: number }>();
  pos.set(nodes[0], { x: cx, y: cy });
  others.forEach((h, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, others.length)) * Math.PI * 2;
    const r = 132;
    pos.set(h, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  });
  return (
    <div className="section" style={{ gap: 6 }}>
      <div className="eyebrow">Linkkigraafi · solmu = täsmällinen osuma</div>
      <div className="row" style={{ fontSize: 12 }}>
        <label className="check">
          1D ≤
          <select className="input" style={{ minHeight: 32, width: 100 }} value={maxD1} onChange={(e) => setMaxD1(Number(e.target.value))}>
            <option value={300}>300</option>
            <option value={1000}>1 000</option>
            <option value={10000}>10 000</option>
          </select>
        </label>
        <label className="check">
          3D ≤
          <select className="input" style={{ minHeight: 32, width: 90 }} value={maxD3} onChange={(e) => setMaxD3(Number(e.target.value))}>
            <option value={0.02}>0,02</option>
            <option value={0.08}>0,08</option>
            <option value={0.25}>0,25</option>
          </select>
        </label>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Osumien linkkigraafi">
        {edges.map((e, i) => {
          const a = pos.get(nodes[e.a])!, b = pos.get(nodes[e.b])!;
          const strong = e.types.filter((t) => t !== 'sama pinta');
          return strong.map((t, k) => {
            const off = (k - (strong.length - 1) / 2) * 3;
            const dx = b.y - a.y, dy = a.x - b.x;
            const len = Math.hypot(dx, dy) || 1;
            return (
              <line
                key={`${i}-${t}`}
                x1={a.x + (dx / len) * off}
                y1={a.y + (dy / len) * off}
                x2={b.x + (dx / len) * off}
                y2={b.y + (dy / len) * off}
                stroke={LINK_COLORS[t]}
                strokeWidth={1.6}
                opacity={0.85}
              />
            );
          });
        })}
        {nodes.map((h, i) => {
          const p = pos.get(h)!;
          const t = termOf(h.termId);
          return (
            <g key={`${h.termId}@${h.n}`} className="graph-node" onClick={() => select({ termId: h.termId, n: h.n })}>
              <circle cx={p.x} cy={p.y} r={i === 0 ? 11 : 7} fill={t?.color ?? '#888'} stroke="var(--bg)" strokeWidth={2} />
              <text x={p.x} y={p.y + (p.y > cy ? 22 : -14)} textAnchor="middle" style={{ fill: 'var(--fg-2)' }}>
                {t?.label} {fmtN(h.n)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ fontSize: 12 }}>
        {Object.entries(LINK_COLORS)
          .filter(([k]) => k !== 'sama pinta')
          .map(([k, v]) => (
            <span key={k} className="row" style={{ gap: 5 }}>
              <span style={{ width: 16, height: 3, background: v, display: 'inline-block', borderRadius: 2 }} />
              {k === 'Fibonacci' ? 'Δn = F_k' : k}
            </span>
          ))}
      </div>
    </div>
  );
}
