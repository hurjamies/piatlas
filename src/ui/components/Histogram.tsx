import { histogram } from '../../core/stats';
import { fmtMetric } from '../format';
import { useWidth } from './useWidth';

/** Kontrollijakauman histogrammi ja havaittu arvo pystyviivana. */
export function Histogram({
  values,
  observed,
  metric,
  label = 'havaittu',
}: {
  values: ArrayLike<number>;
  observed: number;
  metric: '1d' | '2d' | '3d';
  label?: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const finite = Array.from(values).filter(Number.isFinite);
  if (!finite.length) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  // Rajataan näkymä 99. persentiiliin, jotta pitkä häntä ei litistä jakaumaa.
  const hiQ = sorted[Math.floor(sorted.length * 0.99)];
  const lo = Math.min(sorted[0], observed);
  const hi = Math.max(hiQ, observed) * 1.02 + 1e-12;
  const bins = 32;
  const h = histogram(finite, bins, lo, hi);
  const max = Math.max(...h.counts);
  const H = 190, L = 34, R = 12, T = 24, B = 34;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const y = (c: number) => T + (1 - c / max) * (H - T - B);
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  return (
    <div ref={ref} style={{ width: '100%' }}>
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }} role="img" aria-label="Nollamallin jakauma ja havaittu arvo">
      {[0.5, 1].map((f) => (
        <line key={f} className="grid" x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} />
      ))}
      <text x={L - 6} y={y(max) + 4} textAnchor="end">
        {max}
      </text>
      <text x={L - 6} y={y(0) + 4} textAnchor="end">
        0
      </text>
      {h.counts.map((c, i) => {
        const x0 = x(lo + i * h.w);
        const x1 = x(lo + (i + 1) * h.w);
        return <rect key={i} x={x0 + 0.5} y={y(c)} width={Math.max(0.5, x1 - x0 - 1)} height={H - B - y(c)} fill="#3d7f86" />;
      })}
      <line className="axis" x1={L} x2={W - R} y1={H - B} y2={H - B} />
      {ticks.map((t, i) => (
        <text key={i} x={x(t)} y={H - B + 16} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
          {fmtMetric(metric, t)}
        </text>
      ))}
      <line x1={x(observed)} x2={x(observed)} y1={T - 6} y2={H - B} stroke="var(--gold)" strokeWidth={2.5} />
      <text x={Math.min(W - R - 4, Math.max(L + 4, x(observed)))} y={T - 10} textAnchor={x(observed) > W * 0.7 ? 'end' : 'start'} style={{ fill: 'var(--gold)' }}>
        {label} {fmtMetric(metric, observed)}
      </text>
      <text x={W - R} y={H - 4} textAnchor="end">
        etäisyys (pienempi = lähempänä)
      </text>
    </svg>
    </div>
  );
}
