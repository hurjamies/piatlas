// Ankkurin naapurit: lähimmät osumat 1D-indeksin ja 3D-etäisyyden mukaan, pintasuhteet ja Fibonacci-erot.

import { fibIndexOf, nearestFib, NearestFib } from './fibonacci';
import { chordDistance, faceBits, faceRelation, FaceRelation, mapIndex, Vec3 } from './mapping';

export interface HitPoint {
  termId: string;
  n: number;
  len: number;
  p: Vec3;
  face: number;
}

export function hitPoint(termId: string, n: number, len: number): HitPoint {
  const p = mapIndex(n);
  return { termId, n, len, p, face: faceBits(p) };
}

export interface NeighborRow {
  hit: HitPoint;
  d1: number;
  d3: number;
  relation: FaceRelation;
  fib: NearestFib;
  fibExactK: number | null;
}

export function neighborRow(anchor: HitPoint, h: HitPoint): NeighborRow {
  const d1 = Math.abs(h.n - anchor.n);
  return {
    hit: h,
    d1,
    d3: chordDistance(anchor.p, h.p),
    relation: faceRelation(anchor.face, h.face),
    fib: nearestFib(d1),
    fibExactK: fibIndexOf(d1),
  };
}

export interface NeighborFilter {
  excludeSameTerm?: boolean;
  maxD1?: number | null;
  maxD3?: number | null;
  faces?: 'all' | 'same' | 'same-or-edge';
  termIds?: string[] | null;
}

function passes(anchor: HitPoint, r: NeighborRow, f: NeighborFilter): boolean {
  if (r.hit.termId === anchor.termId && r.hit.n === anchor.n) return false;
  if (f.excludeSameTerm && r.hit.termId === anchor.termId) return false;
  if (f.termIds && !f.termIds.includes(r.hit.termId)) return false;
  if (f.maxD1 != null && r.d1 > f.maxD1) return false;
  if (f.maxD3 != null && r.d3 > f.maxD3) return false;
  if (f.faces === 'same' && r.relation !== 'sama') return false;
  if (f.faces === 'same-or-edge' && r.relation !== 'sama' && r.relation !== 'reunanaapuri') return false;
  return true;
}

/** Top-k lähintä osumaa erikseen 1D- ja 3D-järjestyksessä. */
export function topNeighbors(anchor: HitPoint, pool: HitPoint[], k = 20, filter: NeighborFilter = {}) {
  const rows: NeighborRow[] = [];
  for (const h of pool) {
    const r = neighborRow(anchor, h);
    if (passes(anchor, r, filter)) rows.push(r);
  }
  const by1 = [...rows].sort((a, b) => a.d1 - b.d1 || a.d3 - b.d3).slice(0, k);
  const by3 = [...rows].sort((a, b) => a.d3 - b.d3 || a.d1 - b.d1).slice(0, k);
  return { by1, by3, total: rows.length };
}

export type LinkType = '1D' | '3D' | 'Fibonacci' | 'sama pinta';

export interface GraphEdge {
  a: number;
  b: number;
  types: LinkType[];
}

/**
 * Linkkigraafi, jossa solmu on täsmällinen osuma (termi + alkukohta). Särmä syntyy, jos
 * osumat ovat lähellä 1D:ssä tai 3D:ssä, niiden indeksiero on Fibonacci-luku tai ne ovat samalla pinnalla.
 */
export function buildLinkGraph(nodes: HitPoint[], opts: { maxD1: number; maxD3: number }): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const types: LinkType[] = [];
      const d1 = Math.abs(a.n - b.n);
      if (d1 <= opts.maxD1) types.push('1D');
      if (chordDistance(a.p, b.p) <= opts.maxD3) types.push('3D');
      if (fibIndexOf(d1) != null) types.push('Fibonacci');
      if (a.face === b.face) types.push('sama pinta');
      if (types.some((t) => t !== 'sama pinta')) edges.push({ a: i, b: j, types });
    }
  return edges;
}
