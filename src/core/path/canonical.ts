// Path Discovery: kanoninen kysely ja tuloksen sormenjälki. Määrittely: docs/POLKUHAKU.md §5.
//
// Kanoninen merkkijono sisältää kaiken, mikä vaikuttaa hakuun: koodit rooleittain (järjestettyinä), käytössä olevat
// säännöt, parametrit, hakutilan ja version. Käyttäjän symboliset tekstit (lähtö- ja tavoiteteksti, tunnisteiden
// nimet, aikarajaus) kirjataan erikseen kenttään "symbolinen": ne tallentuvat, mutta eivät vaikuta hakuun muuten kuin
// koodien kautta, jotka ovat mukana jo sellaisenaan. SHA-256 lasketaan tilakerroksessa tästä merkkijonosta.

import { encodeIdentifier, identifiersForTimeRange, ROLE_ORDER } from './identifiers';
import { activeRules } from './rules';
import type { IdentifierRole, PathParams, PathQuery, SearchMode } from './types';
import { PATH_VERSION } from './types';

/** JSON, jossa objektien avaimet ovat aina järjestyksessä (sama sisältö → sama merkkijono). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Haun parametrit kanonisessa muodossa: säännöt = activeRules (369 vain use369 = true). */
export function canonicalParams(params: PathParams): Record<string, unknown> {
  return {
    rules: activeRules(params).map((r) => r.id),
    use369: !!params.use369,
    indexWindow: params.indexWindow,
    fibKMin: params.fibKMin,
    fibKMax: params.fibKMax,
    nearestK: params.nearestK,
    chordMax: params.chordMax,
    minCodeLength: params.minCodeLength,
    maxHitsPerCode: params.maxHitsPerCode,
    maxEdges: params.maxEdges,
    budget: params.budget,
    maxRoutes: params.maxRoutes,
  };
}

/**
 * Kanoninen kysely. Hakuun vaikuttavat: versio, tila, parametrit ja koodit rooleittain (aikarajauksen jälkeen,
 * koodausvirheelliset pois). "symbolinen" kirjaa käyttäjän tekstit ja tunnisteet, mutta ei vaikuta hakuun.
 */
export function canonicalQuery(query: PathQuery, params: PathParams, mode: SearchMode): string {
  const { identifiers } = identifiersForTimeRange(query.identifiers, null, query.timeRange);
  const codes: Record<IdentifierRole, string[]> = { lähtö: [], tavoite: [], tunnettu: [] };
  for (const id of identifiers) {
    const e = encodeIdentifier(id);
    if (e.ok && ROLE_ORDER.includes(id.role) && !codes[id.role].includes(e.code)) codes[id.role].push(e.code);
  }
  for (const r of ROLE_ORDER) codes[r].sort(cmp);
  const symbolic = query.identifiers
    .map((id) => ({
      rooli: id.role,
      tyyppi: id.kind,
      nimi: id.label,
      arvo: id.value,
      muoto: id.dateFormat ?? null,
      alkuperä: id.origin,
    }))
    .sort((a, b) => cmp(stableStringify(a), stableStringify(b)));
  return stableStringify({
    versio: PATH_VERSION,
    tila: mode,
    parametrit: canonicalParams(params),
    koodit: codes,
    symbolinen: {
      huomautus: 'Kirjattu, ei vaikuta hakuun: haku käyttää vain yllä olevia koodeja.',
      lähtöteksti: query.startText ?? '',
      tavoiteteksti: query.goalText ?? '',
      tunnisteet: symbolic,
      aikarajaus: query.timeRange ?? null,
    },
  });
}

/** FNV-1a (32 bit) UTF-8-tavuista, 8 heksadesimaalia. Tuloksen sormenjälki toistettavuuden tarkistukseen. */
export function fnv1a(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
