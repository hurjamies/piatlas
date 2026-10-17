// Reitti (murupolku): lista askelia root-solmusta alkaen. Määrittely: docs/MATRIISI.md §2.
// Reitille ei koskaan lisätä solmua, joka on jo sillä: jos käyttäjä avaa reitillä olevan solmun, reitti
// katkaistaan takaisin siihen ("↺ jo polulla"). Tämä estää silmukat. Suurin pituus on MAX_DEPTH.

import { expand, GROUPS } from './expand';
import type { MatrixEdge, MatrixEnv, NodeRef, TrailStep } from './types';
import { MAX_DEPTH, nodeKey, normName, realmOf } from './types';

export type OpenResult = 'lisätty' | 'palattu' | 'syvyysraja';

export function rootTrail(): TrailStep[] {
  return [{ ref: { kind: 'root' }, via: null }];
}

/** Reitin askelten solmuavaimet. */
export function trailKeys(trail: TrailStep[]): string[] {
  return trail.map((s) => nodeKey(s.ref));
}

/** Solmun indeksi reitillä tai −1. */
export function isOnTrail(trail: TrailStep[], ref: NodeRef): number {
  const k = nodeKey(ref);
  return trail.findIndex((s) => nodeKey(s.ref) === k);
}

/** Reitti kohtaan `index` asti (mukaan lukien). Juuri säilyy aina. */
export function truncateTo(trail: TrailStep[], index: number): TrailStep[] {
  if (!trail.length) return rootTrail();
  const i = Number.isInteger(index) ? Math.min(Math.max(index, 0), trail.length - 1) : trail.length - 1;
  return trail.slice(0, i + 1);
}

/** Askelindeksit i ≥ 1, joissa kerros (π-data / tarinaverkko) vaihtuu edelliseen askeleeseen verrattuna. */
export function crossings(trail: TrailStep[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < trail.length; i++) if (realmOf(trail[i].ref) !== realmOf(trail[i - 1].ref)) out.push(i);
  return out;
}

/**
 * Avaa särmän reitin kohdasta `fromIndex` (oletus: viimeinen askel).
 *  - Jos kohde on jo reitillä kohdassa i ≤ fromIndex → reitti katkaistaan siihen: 'palattu'.
 *  - Jos uusi pituus ylittäisi MAX_DEPTH → reitti ennallaan: 'syvyysraja'.
 *  - Muuten reitti kohtaan fromIndex asti + uusi askel, jonka `via` kopioidaan särmästä: 'lisätty'.
 * Syötettä ei muuteta.
 */
export function openEdge(
  trail: TrailStep[],
  edge: MatrixEdge,
  fromIndex?: number,
): { trail: TrailStep[]; result: OpenResult } {
  const base = trail.length ? trail : rootTrail();
  const from =
    fromIndex == null || !Number.isInteger(fromIndex) ? base.length - 1 : Math.min(Math.max(fromIndex, 0), base.length - 1);
  const key = nodeKey(edge.to);
  for (let i = 0; i <= from; i++) if (nodeKey(base[i].ref) === key) return { trail: base.slice(0, i + 1), result: 'palattu' };
  if (from + 2 > MAX_DEPTH) return { trail: base, result: 'syvyysraja' };
  const step: TrailStep = {
    ref: edge.to,
    via: { relation: edge.relation, layer: edge.layer, crossesRealm: edge.crossesRealm, trace: edge.trace, group: edge.group },
  };
  return { trail: [...base.slice(0, from + 1), step], result: 'lisätty' };
}

/**
 * Ensimmäinen testireitti (docs/MATRIISI.md §9) todellisia expand()-särmiä pitkin:
 * root → koodi 629 (MAX) → numero 2 (629#1) → tulkinta (konteksti koodi 629, symboli 2) → nimi HANNA → henkilö.
 * Henkilö ja nimi luetaan tulkinnasta (siemenessä HANNA ja hanna-3). Puuttuva särmä → virhe, ja kävely pysähtyy.
 */
export function firstTestRoute(env: MatrixEnv): { trail: TrailStep[]; errors: string[] } {
  const errors: string[] = [];
  let trail = rootTrail();
  const code = '629';
  const gloss = env.story.glosses.find((g) => g.context.kind === 'koodi' && g.context.code === code && g.symbol === code[1]) ?? null;

  const step = (label: string, pick: (edges: MatrixEdge[]) => MatrixEdge | undefined): boolean => {
    const from = trail[trail.length - 1].ref;
    const edge = pick(expand(from, env, { hitLimit: 0 }).edges);
    if (!edge) {
      errors.push(`Särmää ei löytynyt: ${nodeKey(from)} → ${label}.`);
      return false;
    }
    const r = openEdge(trail, edge);
    if (r.result !== 'lisätty') {
      errors.push(`Askelta ${nodeKey(from)} → ${label} ei voitu lisätä (${r.result}).`);
      return false;
    }
    trail = r.trail;
    return true;
  };

  const prefixOk =
    step(`code:${code}`, (es) => {
      const to629 = es.filter((e) => e.to.kind === 'code' && e.to.code === code);
      return to629.find((e) => e.group === GROUPS.testRoute) ?? to629[0];
    }) && step(`digit:${code}#1`, (es) => es.find((e) => e.to.kind === 'digit' && e.to.code === code && e.to.index === 1));
  if (!prefixOk) return { trail, errors };
  if (!gloss) {
    errors.push(`Tarinasta puuttuu tulkinta, jonka konteksti on koodi ${code} ja symboli ${code[1]}.`);
    return { trail, errors };
  }

  if (step(`gloss:${gloss.id}`, (es) => es.find((e) => e.to.kind === 'gloss' && e.to.glossId === gloss.id))) {
    const name = gloss.name != null && normName(gloss.name) ? normName(gloss.name) : null;
    const personId = gloss.personId ?? null;
    if (!name) errors.push(`Tulkinnalla "${gloss.id}" ei ole nimeä.`);
    else if (step(`name:${name}`, (es) => es.find((e) => e.to.kind === 'name' && e.to.name === name))) {
      if (!personId) errors.push(`Tulkinnalla "${gloss.id}" ei ole henkilöä.`);
      else step(`person:${personId}`, (es) => es.find((e) => e.to.kind === 'person' && e.to.personId === personId));
    }
  }
  return { trail, errors };
}
