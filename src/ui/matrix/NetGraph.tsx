// 2D-verkkokuva: fokussolmu keskellä ja sen kohteet kehällä (enintään 24, loput listassa). Viivan tyyli kertoo
// yhteyden tyypin, nuolenkärki suunnallisen yhteyden ja vinoneliö kerrosvaihdon (π-data ↔ tarinaverkko).
// Nimilaput kulkevat säteen suuntaisesti, jotta ne mahtuvat luettavina 360–412 px leveälle näytölle.
import { useMemo } from 'react';
import type { Expansion, Layer, MatrixEdge, MatrixEnv } from '../../core/matrix/types';
import { LAYER_LABELS, realmOf } from '../../core/matrix/types';
import { useWidth } from '../components/useWidth';
import { pickGraphTargets, shortLabel, truncate } from './labels';

export const GRAPH_CAP = 24;
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
  const cy = S / 2;
  const R0 = S / 2 - 4;
  const r = Math.max(52, R0 * (targets.length > 12 ? 0.41 : 0.34));
  const labelStart = r + 11;
  const maxChars = Math.max(6, Math.floor((R0 - labelStart) / 6.1));
  const n = targets.length;
  const step = n ? (2 * Math.PI) / n : 0;
  const half = Math.min(step / 2, Math.PI / 9);
  const centerText = truncate(exp.node.title, 18);
  const pillW = Math.min(2 * r - 8, centerText.length * 6.7 + 18);

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
            viewBox={`0 0 ${W} ${S}`}
            width={W}
            height={S}
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
              const th = -Math.PI / 2 + i * step;
              const c = Math.cos(th);
              const s = Math.sin(th);
              const e = t.edge;
              const toRealm = realmOf(e.to);
              const mid = r * 0.6;
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
              const th = -Math.PI / 2 + i * step;
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
              const label = truncate(`${trail ? '↺ ' : ''}${shortLabel(e.to, env.story, env.events)}`, maxChars);
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
                  <circle cx={nx} cy={ny} r={6.5} className={`mx-node r-${toRealm}`} />
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
            <rect x={cx - pillW / 2} y={cy - 13} width={pillW} height={26} rx={13} className={`mx-center r-${exp.node.realm}`} />
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
