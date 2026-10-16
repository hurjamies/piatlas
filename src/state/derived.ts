// Johdetut tiedot (muistetaan viitteen perusteella, ettei samaa lasketa joka renderöinnillä).

import { useMemo } from 'react';
import { hitPoint, HitPoint } from '../core/neighbors';
import { nearestIndex } from '../core/search';
import { SearchTerm } from '../core/types';
import { AppState, TermHits, useApp } from './store';

export interface TermView {
  term: SearchTerm;
  hits: TermHits | undefined;
}

export function useTerms(): SearchTerm[] {
  return useApp((s) => s.terms);
}

export function useHits(): Record<string, TermHits> {
  return useApp((s) => s.hits);
}


const pointCache = new WeakMap<Int32Array, HitPoint[]>();

/** Termin kaikki osumat 3D-pisteinä (välimuistissa per hakutulos). */
export function hitPointsOf(termId: string, h: TermHits | undefined): HitPoint[] {
  if (!h || h.status !== 'ready') return [];
  let pts = pointCache.get(h.hits);
  if (!pts) {
    pts = Array.from(h.hits, (n) => hitPoint(termId, n, h.code.length));
    pointCache.set(h.hits, pts);
  }
  return pts;
}

export function useVisiblePool(): HitPoint[] {
  const terms = useTerms();
  const hits = useHits();
  return useMemo(() => terms.filter((t) => t.visible).flatMap((t) => hitPointsOf(t.id, hits[t.id])), [terms, hits]);
}

export function useAllPool(): HitPoint[] {
  const terms = useTerms();
  const hits = useHits();
  return useMemo(() => terms.flatMap((t) => hitPointsOf(t.id, hits[t.id])), [terms, hits]);
}

/** Jokaiselle näkyvälle termille ankkuria lähin osuma (1D). Näille piirretään nimilaput. */
export function companionsOf(s: Pick<AppState, 'terms' | 'hits' | 'anchor'>): { termId: string; n: number }[] {
  const out: { termId: string; n: number }[] = [];
  for (const t of s.terms) {
    if (!t.visible) continue;
    const h = s.hits[t.id];
    if (!h || h.status !== 'ready' || !h.count) continue;
    if (t.id === s.anchor.termId) continue;
    const i = nearestIndex(h.hits, s.anchor.n);
    if (i >= 0) out.push({ termId: t.id, n: h.hits[i] });
  }
  return out;
}

export function useCompanions() {
  const terms = useApp((s) => s.terms);
  const hits = useApp((s) => s.hits);
  const anchor = useApp((s) => s.anchor);
  return useMemo(() => companionsOf({ terms, hits, anchor }), [terms, hits, anchor]);
}

export function isHitOf(h: TermHits | undefined, n: number): boolean {
  if (!h || h.status !== 'ready') return false;
  const i = nearestIndex(h.hits, n);
  return i >= 0 && h.hits[i] === n;
}
