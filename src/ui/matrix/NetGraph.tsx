// 2D-verkkokuva: fokussolmu keskellä ja sen kohteet kehällä (enintään 24, loput listassa). Viivan tyyli kertoo
// yhteyden tyypin, nuolenkärki suunnallisen yhteyden ja vinoneliö kerrosvaihdon (π-data ↔ tarinaverkko).
// Nimilaput kulkevat säteen suuntaisesti, jotta ne mahtuvat luettavina 360–412 px leveälle näytölle. Kehän
// solmut pidetään keskilapun ulkopuolella (ringLayout), joten lappu ei peitä niitä.
import { useMemo } from 'react';
import type { Expansion, Layer, MatrixEdge, MatrixEnv } from '../../core/matrix/types';
import { LAYER_LABELS, realmOf } from '../../core/matrix/types';
import { useWidth } from '../components/useWidth';
import { minAngleGap, pickGraphTargets, ringLayout, shortLabel, truncate } from './labels';

export const GRAPH_CAP = 24;
const NODE_R = 6.5;
/** Keskilapun puolikorkeus. */
const PILL_H2 = 13;
/** IBM Plex Mono 11,5 px: merkin leveys 0,6 em. */
const CENTER_CHAR_W = 6.9;
/** IBM Plex Sans 11 px: leveähkö keskiarvo (isot kirjaimet), jotta korkeusarvio ei leikkaa nimilappuja. */
const LABEL_CHAR_W = 6.6;
const LAYERS: Layer[] = ['matemaattinen', 'geometrinen', 'ajallinen', 'symbolinen'];

export function NetGraph({
  exp,
  env,
  visited,
  onTrail,
  onOpen,
}: {
  exp: Expansion;
  env: MatrixEnv;
  visited: Set<string>;
  onTrail: Map<string, number>;
  onOpen: (e: MatrixEdge) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>(360, 260);
  const { targets, totalTargets } = useMemo(() => pickGraphTargets(exp.edges, GRAPH_CAP), [exp.edges]);
  const S = Math.min(W, 520);
  const cx = W / 2;
  const R0 = S / 2 - 4;
  const r = Math.max(52, R0 * (targets.length > 12 ? 0.41 : 0.34));
  const labelStart = r + 11;
  const maxChars = Math.max(6, Math.floor((R0 - labelStart) / 6.1));
  const n = targets.length;
  // Keskimmäinen nimilappu on vaakasuora. Asettelu (ringLayout) pitää kehän solmut sen ulkopuolella: lappu saa
  // koko leveytensä, jos solmut mahtuvat sen ylä- ja alapuolelle; muuten lapun teksti lyhennetään.
  const fullW = Math.min(2 * (R0 - 8), Array.from(exp.node.title).length * CENTER_CHAR_W + 18);
  const layout = useMemo(() => ringLayout(n, r, fullW / 2, PILL_H2, NODE_R), [n, r, fullW]);
  const angles = layout.angles;
  const half = Math.min(minAngleGap(angles) / 2, Math.PI / 9);
  const centerText =
    fullW / 2 <= layout.pillHalf + 0.5
      ? exp.node.title
      : truncate(exp.node.title, Math.max(4, Math.floor((2 * layout.pillHalf - 18) / CENTER_CHAR_W + 1e-6)));
  const pillW = Math.min(2 * layout.pillHalf, Array.from(centerText).length * CENTER_CHAR_W + 18);
  const labels = targets.map((t) => truncate(`${onTrail.has(t.key) ? '↺ ' : ''}${shortLabel(t.edge.to, env.story, env.events)}`, maxChars));
  // Kuvan korkeus nimilappujen pystysuuntaisen ulottuman mukaan (ylä- ja alapuoli erikseen): vähän kohteita →
  // matalampi kuva puhelimessa. Kehä piirretään aina kokonaan.
  let up = r + NODE_R + 6;
  let down = up;
  labels.forEach((l, i) => {
    const s = Math.sin(angles[i]);
    const reach = Math.abs(s) * (labelStart + Array.from(l).length * LABEL_CHAR_W) + 8;
    if (s < 0) up = Math.max(up, reach);
    else down = Math.max(down, reach);
  });
  up = Math.min(up, S / 2);
  down = Math.min(down, S / 2);
  const H = Math.ceil(up + down);
  const cy = up;
  /** Kerrosvaihdon vinoneliö säteelle niin, ettei keskilappu peitä sitä. */
  const crossAt = (c: number, s: number) => {
    const need = Math.min(Math.abs(s) > 1e-6 ? (PILL_H2 + 6) / Math.abs(s) : Infinity, Math.abs(c) > 1e-6 ? (pillW / 2 + 6) / Math.abs(c) : Infinity);
    return Math.min(Math.max(r * 0.6, need), r - 13);
  };

  return (
    <section className="card mx-net-card" aria-label="Verkko: fokussolmu ja sen yhteydet">
      <div ref={ref} style={{ width: '100%' }}>
        {n === 0 ? (
          <div className="muted mx-small" style={{ padding: '18px 0' }}>
            Solmusta ei lähde yhteyksiä tässä suunnassa.
          </div>
        ) : (
          <svg
            className="mx-net"
            data-testid="matrix-net"
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label={`Verkko: ${exp.node.title} ja ${n} kohdetta`}
          >
            <defs>
              {LAYERS.map((l) => (
                <marker key={l} id={`mx-arrow-${l}`} viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" className={`mx-arrow l-${l}`} />
                </marker>
              ))}
            </defs>
            <circle cx={cx} cy={cy} r={r} className="mx-ring" />
            {targets.map((t, i) => {
              const th = angles[i];
              const c = Math.cos(th);
              const s = Math.sin(th);
              const e = t.edge;
              const toRealm = realmOf(e.to);
              const mid = crossAt(c, s);
              return (
                <g key={t.key}>
                  <line
                    x1={cx + c * 18}
                    y1={cy + s * 18}
                    x2={cx + c * (r - 8)}
                    y2={cy + s * (r - 8)}
                    className={`mx-net-edge l-${e.layer}`}
                    markerEnd={e.direction ? `url(#mx-arrow-${e.layer})` : undefined}
                  />
                  {e.crossesRealm && (
                    <rect
                      x={cx + c * mid - 3.5}
                      y={cy + s * mid - 3.5}
                      width={7}
                      height={7}
                      className={`mx-cross-mark r-${toRealm}`}
                      transform={`rotate(45 ${cx + c * mid} ${cy + s * mid})`}
                    />
                  )}
                </g>
              );
            })}
            {targets.map((t, i) => {
              const th = angles[i];
              const c = Math.cos(th);
              const s = Math.sin(th);
              const e = t.edge;
              const toRealm = realmOf(e.to);
              const nx = cx + c * r;
              const ny = cy + s * r;
              const lx = cx + c * labelStart;
              const ly = cy + s * labelStart;
              const left = c < -1e-9;
              const deg = (th * 180) / Math.PI + (left ? 180 : 0);
              const trail = onTrail.has(t.key);
              const seen = visited.has(t.key);
              const label = labels[i];
              const a0 = th - half;
              const a1 = th + half;
              const rin = r - 14;
              const wedge = `M${cx + Math.cos(a0) * rin},${cy + Math.sin(a0) * rin} L${cx + Math.cos(a0) * R0},${cy + Math.sin(a0) * R0} A${R0},${R0} 0 0 1 ${cx + Math.cos(a1) * R0},${cy + Math.sin(a1) * R0} L${cx + Math.cos(a1) * rin},${cy + Math.sin(a1) * rin} A${rin},${rin} 0 0 0 ${cx + Math.cos(a0) * rin},${cy + Math.sin(a0) * rin} Z`;
              return (
                <g
                  key={t.key}
                  className={`mx-net-node${trail ? ' trail' : ''}${seen ? ' seen' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Avaa ${shortLabel(e.to, env.story, env.events)} (${LAYER_LABELS[e.layer]}, ${e.relation})`}
                  data-key={t.key}
                  onClick={() => onOpen(e)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      onOpen(e);
                    }
                  }}
                >
                  <path d={wedge} className="mx-hit" />
                  <circle cx={nx} cy={ny} r={NODE_R} className={`mx-node r-${toRealm}`} />
                  {seen && !trail && <circle cx={nx} cy={ny} r={2} className="mx-node-dot" />}
                  <text
                    x={lx}
                    y={ly}
                    className={`mx-net-label r-${toRealm}`}
                    textAnchor={left ? 'end' : 'start'}
                    dominantBaseline="central"
                    transform={`rotate(${deg} ${lx} ${ly})`}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
            <rect x={cx - pillW / 2} y={cy - PILL_H2} width={pillW} height={2 * PILL_H2} rx={PILL_H2} className={`mx-center r-${exp.node.realm}`} />
            <text x={cx} y={cy} className="mx-center-label" textAnchor="middle" dominantBaseline="central">
              {centerText}
            </text>
          </svg>
        )}
      </div>
      <div className="mx-legend" aria-label="Selite">
        {LAYERS.map((l) => (
          <span key={l} className="mx-legend-item">
            <svg width="26" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="25" y2="4" className={`mx-net-edge l-${l}`} />
            </svg>
            {LAYER_LABELS[l]}
          </span>
        ))}
        <span className="mx-legend-item">
          <span className="mx-dot r-pi" /> π-data
        </span>
        <span className="mx-legend-item">
          <span className="mx-dot r-tarina" /> Tarinaverkko
        </span>
        <span className="mx-legend-item">◆ kerros vaihtuu</span>
        <span className="mx-legend-item">➝ suunnallinen</span>
        <span className="mx-legend-item">↺ jo polulla</span>
      </div>
      {totalTargets > n && (
        <div className="mx-small faint">
          Kuvassa {n}/{totalTargets} kohdetta ({exp.edges.length} yhteyttä); kaikki ovat listassa alla.
        </div>
      )}
    </section>
  );
}
