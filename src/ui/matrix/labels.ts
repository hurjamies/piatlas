// Matriisin käyttöliittymän puhtaat apufunktiot (ei Reactia): lyhyet solmunimet, ryhmittely, verkkokuvan
// kohteiden valinta ja suunnan selitys. Testataan tests/matrix-state.test.ts:ssä.

import { fmtIndex, fmtSignedIndex } from '../../core/matrix/expand';
import { getGloss, getPath, personLabel } from '../../core/matrix/story';
import type { Direction, DirectionDomain, MatrixEdge, MatrixEvent, NodeKind, NodeRef, Realm, StoryModel } from '../../core/matrix/types';
import { DIRECTION_SEMANTICS, directionLabel, DOMAIN_LABELS, nodeKey } from '../../core/matrix/types';

export const KIND_LABELS: Record<NodeKind, string> = {
  root: 'lähtöankkuri',
  name: 'nimi',
  code: 'koodi',
  digit: 'numeroportti',
  hit: 'osuma',
  position: 'π-indeksi',
  gloss: 'tulkinta',
  person: 'henkilö',
  homonyms: 'samannimiset',
  path: 'polku',
  junction: 'polkujen yhdistys',
  event: 'tapahtuma',
};

/** Lyhyt nimi solmulle verkkokuvaan ja listaan (ei laskentaa, vain tarinamallin haku). */
export function shortLabel(ref: NodeRef, story: StoryModel, events: MatrixEvent[] = []): string {
  switch (ref.kind) {
    case 'root':
      return 'Lähtöankkuri';
    case 'name':
      return ref.name;
    case 'code':
      return `koodi ${ref.code}`;
    case 'digit':
      return `${ref.code[ref.index] ?? '?'} · ${ref.index + 1}/${ref.code.length} (${ref.code})`;
    case 'hit':
      return `${ref.code} @${fmtIndex(ref.n)}`;
    case 'position':
      return `@${fmtIndex(ref.n)}`;
    case 'gloss': {
      const g = getGloss(story, ref.glossId);
      return g ? `${g.symbol} = ${g.meanings.join(', ') || '–'}` : `${ref.glossId} (poistettu)`;
    }
    case 'person':
      return personLabel(story, ref.personId);
    case 'homonyms':
      return `${ref.name} · samannimiset`;
    case 'path': {
      const p = getPath(story, ref.pathId);
      return p ? p.title : `${ref.pathId} (poistettu)`;
    }
    case 'junction':
      return `Yhdistys: ${personLabel(story, ref.personId)}`;
    case 'event': {
      const e = events.find((x) => x.id === ref.eventId);
      return e ? e.title : `${ref.eventId} (poistettu)`;
    }
  }
}

/** Merkkijono katkaistuna: "MATTI 62884 @85…" */
export function truncate(s: string, max: number): string {
  const a = Array.from(s);
  return a.length <= max ? s : `${a.slice(0, Math.max(1, max - 1)).join('')}…`;
}

export interface EdgeGroup {
  group: string;
  edges: MatrixEdge[];
}

/** Särmät ryhmittäin ensimmäisen esiintymän järjestyksessä. */
export function groupEdges(edges: MatrixEdge[]): EdgeGroup[] {
  const out: EdgeGroup[] = [];
  const idx = new Map<string, number>();
  for (const e of edges) {
    let i = idx.get(e.group);
    if (i == null) {
      i = out.length;
      idx.set(e.group, i);
      out.push({ group: e.group, edges: [] });
    }
    out[i].edges.push(e);
  }
  return out;
}

export interface GraphTarget {
  key: string;
  edge: MatrixEdge;
  groupIndex: number;
}

/**
 * Verkkokuvan kohteet: jokainen kohdesolmu kerran (ensimmäinen särmä edustaa), enintään `cap` kappaletta.
 * Ryhmistä otetaan vuorotellen yksi kerrallaan, jotta pienetkin ryhmät näkyvät, vaikka yhdessä ryhmässä olisi
 * tuhansia osumia. Tulos järjestetään ryhmittäin, jotta saman ryhmän solmut ovat kehällä vierekkäin.
 */
export function pickGraphTargets(edges: MatrixEdge[], cap = 24): { targets: GraphTarget[]; totalTargets: number } {
  const seen = new Set<string>();
  const groups: { name: string; items: { key: string; edge: MatrixEdge; i: number }[] }[] = [];
  const gIdx = new Map<string, number>();
  edges.forEach((edge, i) => {
    const key = nodeKey(edge.to);
    if (seen.has(key)) return;
    seen.add(key);
    let g = gIdx.get(edge.group);
    if (g == null) {
      g = groups.length;
      gIdx.set(edge.group, g);
      groups.push({ name: edge.group, items: [] });
    }
    groups[g].items.push({ key, edge, i });
  });
  const picked: (GraphTarget & { i: number; within: number })[] = [];
  const pos = groups.map(() => 0);
  let progress = true;
  while (picked.length < cap && progress) {
    progress = false;
    for (let g = 0; g < groups.length && picked.length < cap; g++) {
      const it = groups[g].items[pos[g]];
      if (!it) continue;
      picked.push({ key: it.key, edge: it.edge, groupIndex: g, i: it.i, within: pos[g] });
      pos[g]++;
      progress = true;
    }
  }
  picked.sort((a, b) => a.groupIndex - b.groupIndex || a.within - b.within);
  return { targets: picked.map(({ key, edge, groupIndex }) => ({ key, edge, groupIndex })), totalTargets: seen.size };
}

/** Kulman etäisyys lähimpään vaakasuuntaan (0 tai π), radiaaneina välillä [0, π/2]. */
function fromHorizontal(t: number): number {
  const m = ((t % Math.PI) + Math.PI) % Math.PI;
  return Math.min(m, Math.PI - m);
}

/**
 * Verkkokuvan kehän kulmat (SVG: 0 = oikealle, π/2 = alas, kasvaa myötäpäivään). Keskellä on vaakasuora
 * nimilappu, joten solmut pidetään poissa vaakasuunnan ympäriltä: kehän solmu (säde r) ei saa olla lähempänä
 * vaakaakselia kuin `clearance`. Ensin kokeillaan tasavälistä kehää (alku ylhäällä tai puoli askelta siitä);
 * jos se ei onnistu, solmut jaetaan ylä- ja alakaarelle järjestystä muuttamatta (myötäpäivään vasemmalta ylhäältä).
 */
export function ringAngles(n: number, r: number, clearance: number): number[] {
  if (n <= 0) return [];
  const alpha = Math.asin(Math.min(1, Math.max(0, clearance / r)));
  const step = (2 * Math.PI) / n;
  for (const t0 of [-Math.PI / 2, -Math.PI / 2 + step / 2]) {
    const a = Array.from({ length: n }, (_, i) => t0 + i * step);
    if (a.every((t) => fromHorizontal(t) >= alpha - 1e-9)) return a;
  }
  const span = Math.PI - 2 * alpha;
  if (span < 0.2) return Array.from({ length: n }, (_, i) => -Math.PI / 2 + i * step);
  const nTop = Math.ceil(n / 2);
  const nBot = n - nTop;
  const out: number[] = [];
  for (let j = 0; j < nTop; j++) out.push(-Math.PI + alpha + ((j + 0.5) * span) / nTop);
  for (let j = 0; j < nBot; j++) out.push(alpha + ((j + 0.5) * span) / nBot);
  return out;
}

/**
 * Verkkokuvan asettelu: kehän kulmat ja keskilapun sallittu puolileveys. Lappu (puolikorkeus h2) halutaan
 * leveydelle `wantHalf`. Järjestys:
 *  1. tasavälinen kehä, jos lappu ei peitä yhtään solmua;
 *  2. ylä- ja alakaari (ringAngles), jos solmut eivät ahtaudu päällekkäin;
 *  3. tasavälinen kehä ja kapeampi lappu, joka ulottuu vain lähimpään vaakasuunnan solmuun (teksti lyhennetään).
 */
export function ringLayout(n: number, r: number, wantHalf: number, h2: number, nodeR: number): { angles: number[]; pillHalf: number } {
  const pad = 3;
  const band = h2 + nodeR + pad;
  const covered = (t: number, half: number) => Math.abs(r * Math.sin(t)) < band && Math.abs(r * Math.cos(t)) < half + nodeR + pad;
  if (n <= 0) return { angles: [], pillHalf: wantHalf };
  const step = (2 * Math.PI) / n;
  const uniform = (t0: number) => Array.from({ length: n }, (_, i) => t0 + i * step);
  const starts = [-Math.PI / 2, -Math.PI / 2 + step / 2];
  for (const t0 of starts) {
    const a = uniform(t0);
    if (a.every((t) => !covered(t, wantHalf))) return { angles: a, pillHalf: wantHalf };
  }
  const arcs = ringAngles(n, r, band);
  if (n < 2 || r * minAngleGap(arcs) >= 2 * nodeR + 3) return { angles: arcs, pillHalf: wantHalf };
  let best = { angles: uniform(starts[0]), pillHalf: -Infinity };
  for (const t0 of starts) {
    const a = uniform(t0);
    let half = wantHalf;
    for (const t of a) if (Math.abs(r * Math.sin(t)) < band) half = Math.min(half, Math.abs(r * Math.cos(t)) - nodeR - pad);
    if (half > best.pillHalf) best = { angles: a, pillHalf: half };
  }
  return { angles: best.angles, pillHalf: Math.max(0, best.pillHalf) };
}

/** Pienin kulmaväli vierekkäisten kehän solmujen välillä (kosketusalueen leveys). */
export function minAngleGap(angles: number[]): number {
  if (angles.length < 2) return 2 * Math.PI;
  const s = angles.map((t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  let g = s[0] + 2 * Math.PI - s[s.length - 1];
  for (let i = 1; i < s.length; i++) g = Math.min(g, s[i] - s[i - 1]);
  return g;
}

/** Alueet, joissa suunta tulkitaan tämän solmun särmissä. Ilman suunnallisia särmiä: kerroksen oletusalue. */
export function directionDomains(edges: MatrixEdge[], realm: Realm): DirectionDomain[] {
  const out: DirectionDomain[] = [];
  for (const e of edges) if (e.domain && !out.includes(e.domain)) out.push(e.domain);
  if (!out.length) out.push(realm === 'pi' ? 'pi-indeksi' : 'tarina');
  return out;
}

/** "234 · π-indeksi: kasvava n · spiraali: ulospäin: n + F_k" */
export function directionExplanation(dir: Direction, domains: DirectionDomain[]): string {
  const [first, ...rest] = domains;
  return [directionLabel(dir, first), ...rest.map((d) => `${DOMAIN_LABELS[d]}: ${DIRECTION_SEMANTICS[d][dir]}`)].join(' · ');
}

/** Särmän mittarin arvo luettavaksi: n ja Δn tuhaterottimin, desimaalit pilkulla. */
export function fmtMetricValue(key: string, v: number | string): string {
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '–';
  if (Number.isInteger(v)) return key.startsWith('Δ') || key === 'siirtymä' ? fmtSignedIndex(v) : fmtIndex(v);
  return String(Number(v.toPrecision(6))).replace('.', ',');
}

/** Peräkkäiset samat kerrokset ryhminä: [pi, pi, tarina] → [{pi, 2}, {tarina, 1}]. Ryhmien raja = kerrosvaihto. */
export function realmRuns(realms: Realm[]): { realm: Realm; count: number }[] {
  const out: { realm: Realm; count: number }[] = [];
  for (const r of realms) {
    const last = out[out.length - 1];
    if (last && last.realm === r) last.count++;
    else out.push({ realm: r, count: 1 });
  }
  return out;
}

/** "1 askel" / "3 askelta" */
export function stepsText(k: number): string {
  return `${k} ${k === 1 ? 'askel' : 'askelta'}`;
}
