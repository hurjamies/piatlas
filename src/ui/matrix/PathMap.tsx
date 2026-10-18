// Reittikartta: jokainen reittiehdokas on oma rivinsä, solmut askeljärjestyksessä (x = askeleen indeksi). Särmän väri
// = kerros (matemaattinen turkoosi, geometrinen violetti), 369-muunnokset katkoviivana meripihkalla. Pieni nuoli kertoo,
// kumpi haku tuotti askeleen (234 ▸ lähtöpuoli, ◂ 432 tavoitepuoli). Kohtaamissolmu on korostettu.
// SVG ei skaalaudu: 360 px:ssä kuvaa voi vierittää sivuttain omassa säiliössään, sivu ei vieri.
import type { PathRoute } from '../../core/path/types';
import { fmtCost } from '../../core/path/score';
import { fmtN } from '../format';

const DX = 108;
const ROW_H = 100;
const PAD_L = 48;
const PAD_R = 56;
const TOP = 6;
const R = 9;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function PathMap({ routes }: { routes: PathRoute[] }) {
  if (!routes.length) return null;
  const maxNodes = Math.max(...routes.map((r) => r.nodes.length));
  const W = Math.max(330, PAD_L + (maxNodes - 1) * DX + PAD_R);
  const H = TOP + routes.length * ROW_H;
  const summary = routes
    .map((r, i) => `Reitti ${i + 1}: ${r.nodes.map((n) => `${n.labels.join('/') || n.code} ${n.code}@${n.n}`).join(' → ')}`)
    .join('. ');
  return (
    <div className="pd-map-block">
      <div className="table-wrap pd-map-scroll" data-testid="path-map-wrap">
        <svg
          className="pd-map"
          data-testid="path-map"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Reittikartta. ${summary}`}
        >
          {routes.map((route, i) => {
            const y0 = TOP + i * ROW_H;
            const cy = y0 + 42;
            const x = (j: number) => PAD_L + j * DX;
            return (
              <g key={route.key} className="pd-map-row" data-route={i + 1}>
                <text className="pd-map-head" x={8} y={y0 + 14}>
                  Reitti {i + 1} · {fmtCost(route.cost)}
                </text>
                {route.steps.map((st, j) => {
                  const x1 = x(j) + R;
                  const x2 = x(j + 1) - R;
                  const mid = (x(j) + x(j + 1)) / 2;
                  const cls = st.transform ? 'pd-edge t369' : `pd-edge l-${st.layer}`;
                  return (
                    <g key={`e${j}`}>
                      <line className={cls} x1={x1} y1={cy} x2={x2} y2={cy} data-rule={st.rule} data-side={st.side}>
                        <title>
                          {st.rule} · {st.layer} · {st.side} · {st.formula}
                        </title>
                      </line>
                      <text className={`pd-side s-${st.side}`} x={mid} y={cy - 7} textAnchor="middle">
                        {st.side === '234' ? '234 ▸' : '◂ 432'}
                      </text>
                    </g>
                  );
                })}
                {route.nodes.map((nd, j) => {
                  const role = nd.roles.includes('lähtö') ? 'start' : nd.roles.includes('tavoite') ? 'goal' : 'known';
                  const meet = route.meetIndex === j;
                  const name = nd.labels.join('/') || nd.code;
                  return (
                    <g key={`n${j}`} className={`pd-mnode r-${role}${meet ? ' meet' : ''}`} data-code={nd.code} data-n={nd.n}>
                      <title>
                        {name} · koodi {nd.code} @{fmtN(nd.n)} · {nd.roles.join(', ')}
                        {meet ? ' · rintamat kohtasivat tässä' : ''}
                      </title>
                      {meet && <circle className="pd-meet-ring" cx={x(j)} cy={cy} r={R + 5} />}
                      <circle className="pd-mnode-dot" cx={x(j)} cy={cy} r={R} />
                      {meet && (
                        <text className="pd-meet-label" x={x(j)} y={cy - 17} textAnchor="middle">
                          kohtaaminen
                        </text>
                      )}
                      <text className="pd-mnode-label" x={x(j)} y={cy + 25} textAnchor="middle">
                        {clip(name, 13)}
                      </text>
                      <text className="pd-mnode-code" x={x(j)} y={cy + 39} textAnchor="middle">
                        {nd.code}@{fmtN(nd.n)}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="pd-legend mx-small" aria-label="Reittikartan selite">
        <span>
          <i className="pd-sw l-matemaattinen" /> matemaattinen
        </span>
        <span>
          <i className="pd-sw l-geometrinen" /> geometrinen
        </span>
        <span>
          <i className="pd-sw t369" /> 369-muunnos
        </span>
        <span className="mono">234 ▸ lähtöpuolen askel</span>
        <span className="mono">◂ 432 tavoitepuolen askel</span>
        <span>
          <i className="pd-sw meet" /> kohtaaminen
        </span>
      </div>
    </div>
  );
}
