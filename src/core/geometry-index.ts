// Lähimmän naapurin haku 1D/2D/3D-pisteille. Käytetään sekä naapurilistoissa että Monte Carlossa.

import { mapIndex, vogel } from './mapping';
import { lowerBound } from './search';

export type Metric = '1d' | '2d' | '3d';

export const METRIC_LABELS: Record<Metric, string> = {
  '1d': '1D-indeksiero |Δn|',
  '2d': '2D-spiraalin euklidinen etäisyys',
  '3d': '3D-oktaedrin suora etäisyys (chord)',
};

export function metricDim(m: Metric): number {
  return m === '1d' ? 1 : m === '2d' ? 2 : 3;
}

/** Koordinaatit litteänä taulukkona (dim arvoa / piste). */
export function coordsFor(ns: ArrayLike<number>, metric: Metric, out?: Float64Array): Float64Array {
  const dim = metricDim(metric);
  const c = out && out.length >= ns.length * dim ? out : new Float64Array(ns.length * dim);
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i];
    if (metric === '1d') c[i] = n;
    else if (metric === '2d') {
      const p = vogel(n);
      c[2 * i] = p.x;
      c[2 * i + 1] = p.y;
    } else {
      const p = mapIndex(n);
      c[3 * i] = p.x;
      c[3 * i + 1] = p.y;
      c[3 * i + 2] = p.z;
    }
  }
  return c;
}

export function pointDistance(metric: Metric, a: Float64Array, i: number, b: Float64Array, j: number): number {
  if (metric === '1d') return Math.abs(a[i] - b[j]);
  if (metric === '2d') return Math.hypot(a[2 * i] - b[2 * j], a[2 * i + 1] - b[2 * j + 1]);
  const dx = a[3 * i] - b[3 * j];
  const dy = a[3 * i + 1] - b[3 * j + 1];
  const dz = a[3 * i + 2] - b[3 * j + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Tasainen ruudukko 2D/3D-pisteille. */
export class Grid {
  readonly g: number;
  readonly dim: number;
  readonly min: number;
  readonly cell: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  constructor(readonly coords: Float64Array, readonly count: number, dim: 2 | 3, min: number, max: number) {
    this.dim = dim;
    const per = Math.max(1, Math.floor(Math.pow(Math.max(1, count) / 2, 1 / dim)));
    this.g = Math.min(dim === 3 ? 48 : 384, per);
    this.min = min;
    this.cell = (max - min) / this.g;
    const total = Math.pow(this.g, dim);
    const cellOf = new Int32Array(count);
    const counts = new Int32Array(total + 1);
    for (let i = 0; i < count; i++) {
      const c = this.cellIndexOf(i);
      cellOf[i] = c;
      counts[c + 1]++;
    }
    for (let k = 0; k < total; k++) counts[k + 1] += counts[k];
    this.start = counts;
    const fill = counts.slice(0, total);
    this.items = new Int32Array(count);
    for (let i = 0; i < count; i++) this.items[fill[cellOf[i]]++] = i;
  }
  private axisCell(v: number): number {
    const k = Math.floor((v - this.min) / this.cell);
    return k < 0 ? 0 : k >= this.g ? this.g - 1 : k;
  }
  private cellIndexOf(i: number): number {
    const d = this.dim;
    const cx = this.axisCell(this.coords[d * i]);
    const cy = this.axisCell(this.coords[d * i + 1]);
    const cz = d === 3 ? this.axisCell(this.coords[d * i + 2]) : 0;
    return cx + this.g * (cy + this.g * cz);
  }
  /** Lähin piste kyselypisteeseen q. exclude = ohitettava pisteen indeksi (itse). */
  nearest(qx: number, qy: number, qz: number, exclude = -1): number {
    const g = this.g;
    const d = this.dim;
    const cx = this.axisCell(qx);
    const cy = this.axisCell(qy);
    const cz = d === 3 ? this.axisCell(qz) : 0;
    let best = Number.POSITIVE_INFINITY;
    const co = this.coords;
    for (let r = 0; r <= g; r++) {
      if (r > 0 && (r - 1) * this.cell >= best) break;
      const z0 = d === 3 ? Math.max(0, cz - r) : 0;
      const z1 = d === 3 ? Math.min(g - 1, cz + r) : 0;
      for (let z = z0; z <= z1; z++) {
        const y0 = Math.max(0, cy - r);
        const y1 = Math.min(g - 1, cy + r);
        for (let y = y0; y <= y1; y++) {
          const onShellZY = (d === 3 && Math.abs(z - cz) === r) || Math.abs(y - cy) === r;
          const x0 = Math.max(0, cx - r);
          const x1 = Math.min(g - 1, cx + r);
          for (let x = x0; x <= x1; x++) {
            if (!onShellZY && Math.abs(x - cx) !== r) continue;
            const c = x + g * (y + g * z);
            for (let t = this.start[c]; t < this.start[c + 1]; t++) {
              const i = this.items[t];
              if (i === exclude) continue;
              let dist: number;
              if (d === 3) {
                const dx = co[3 * i] - qx, dy = co[3 * i + 1] - qy, dz = co[3 * i + 2] - qz;
                dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              } else {
                dist = Math.hypot(co[2 * i] - qx, co[2 * i + 1] - qy);
              }
              if (dist < best) best = dist;
            }
          }
        }
      }
    }
    return best;
  }
}

export function gridBounds(metric: Metric, N: number): [number, number] {
  if (metric === '3d') return [-1.000001, 1.000001];
  const R = Math.sqrt(N) + 1;
  return [-R, R];
}

/**
 * Jokaiselle B:n pisteelle etäisyys lähimpään A:n pisteeseen.
 * sameSet = true: A ja B ovat sama joukko, jolloin piste ei kelpaa omaksi naapurikseen.
 */
export function nearestDistances(
  metric: Metric,
  A: ArrayLike<number>,
  B: ArrayLike<number>,
  sameSet: boolean,
  N: number,
): Float64Array {
  const out = new Float64Array(B.length);
  if (!A.length) {
    out.fill(Number.POSITIVE_INFINITY);
    return out;
  }
  if (metric === '1d') {
    const s = Float64Array.from(A as ArrayLike<number>).sort();
    if (sameSet) {
      // B === A: lähin naapuri järjestyksessä; oma paikka ohitetaan. Tulos B:n alkuperäisessä järjestyksessä.
      const order = Array.from({ length: B.length }, (_, i) => i).sort((p, q) => B[p] - B[q]);
      for (let r = 0; r < order.length; r++) {
        const v = B[order[r]];
        const l = r > 0 ? v - B[order[r - 1]] : Number.POSITIVE_INFINITY;
        const h = r < order.length - 1 ? B[order[r + 1]] - v : Number.POSITIVE_INFINITY;
        out[order[r]] = Math.min(l, h);
      }
      return out;
    }
    for (let i = 0; i < B.length; i++) {
      const v = B[i];
      const k = lowerBound(s, v);
      let best = Number.POSITIVE_INFINITY;
      if (k < s.length) best = s[k] - v;
      if (k > 0) best = Math.min(best, v - s[k - 1]);
      out[i] = best;
    }
    return out;
  }
  const dim = metricDim(metric) as 2 | 3;
  const ca = coordsFor(A, metric);
  const cb = sameSet ? ca : coordsFor(B, metric);
  if (A.length * B.length <= 60_000) {
    for (let j = 0; j < B.length; j++) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < A.length; i++) {
        if (sameSet && i === j) continue;
        const dd = pointDistance(metric, ca, i, cb, j);
        if (dd < best) best = dd;
      }
      out[j] = best;
    }
    return out;
  }
  const [mn, mx] = gridBounds(metric, N);
  const grid = new Grid(ca, A.length, dim, mn, mx);
  for (let j = 0; j < B.length; j++) {
    out[j] = grid.nearest(cb[dim * j], cb[dim * j + 1], dim === 3 ? cb[dim * j + 2] : 0, sameSet ? j : -1);
  }
  return out;
}
