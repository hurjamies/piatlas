// Tutkimusraportin vienti: JSON (kaikki toistamiseen tarvittava) ja CSV (osumat).

import { digitsAt } from '../core/digits';
import { JUMP_VERSION, MATRIX_VERSION, nodeKey, OPS369_VERSION, ROUTE_TEST_VERSION } from '../core/matrix/types';
import { PATHSCORE_DISCLAIMER, PATHSCORE_DEFINITION } from '../core/path/score';
import { BLIND_VERSION, PATH_VERSION, PATHSCORE_VERSION } from '../core/path/types';
import { mapIndex, faceBits, faceSignLabel, toP5 } from '../core/mapping';
import { benjaminiHochberg, bonferroni } from '../core/stats';
import { eventTimestamp, hitKey, termEncoding } from '../core/types';
import { ENCODING_VERSION, FORMULA_TEXT, FORMULA_VERSION, NET_VERSION, STATS_VERSION } from '../core/version';
import { routeBH } from './matrix';
import { EXPLORATORY_LABEL, pathBH, pathTestsTotal } from './path';
import { store } from './store';

declare const __APP_VERSION__: string;

export function buildReport() {
  const s = store.get();
  const ps = s.runs.map((r) => r.summary.pValue);
  const q = benjaminiHochberg(ps);
  const b = bonferroni(ps);
  // m = kaikki ajot (rajaamaton hakemisto); tallennuksesta rajattujen ajojen p-arvot oletetaan 1:ksi.
  const routeQ = routeBH(s.matrix.routeRuns.map((r) => r.pValue), s.matrix.runIndex.total);
  // Polkuhaku: p-arvot satunnaisvertailuista ja sokkotesteistä; m = kaikki polkuhaut, vertailut ja sokkotestit.
  const pth = s.matrix.path;
  const pathM = pathTestsTotal(pth.counts);
  const pathPs: { kind: 'vertailu' | 'sokkotesti'; id: string; p: number }[] = [
    ...pth.runs.filter((r) => r.kind === 'vertailu' && r.pValue != null).map((r) => ({ kind: 'vertailu' as const, id: r.id, p: r.pValue as number })),
    ...pth.blindRuns.filter((r) => r.summary).map((r) => ({ kind: 'sokkotesti' as const, id: r.id, p: r.summary!.pVsRandom })),
  ];
  const pathQ = new Map(pathBH(pathPs.map((x) => x.p), pathM).map((q, i) => [pathPs[i].id, q]));
  const linkTs = new Map<string, number | null>();
  for (const e of s.events) for (const k of e.linkedHits) if (!linkTs.has(k)) linkTs.set(k, eventTimestamp(e));
  const interesting = new Set<string>([hitKey(s.anchor)]);
  for (const e of s.events) for (const k of e.linkedHits) interesting.add(k);
  for (const k of Object.keys(s.notes)) interesting.add(k);
  if (s.selection) interesting.add(hitKey(s.selection));
  return {
    app: 'PI ATLAS — The Geometry of a Life',
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
    exportedAt: new Date().toISOString(),
    versions: {
      formula: FORMULA_VERSION,
      encoding: ENCODING_VERSION,
      stats: STATS_VERSION,
      net: NET_VERSION,
      matrix: MATRIX_VERSION,
      ops369: OPS369_VERSION,
      jump: JUMP_VERSION,
      routeTest: ROUTE_TEST_VERSION,
      path: PATH_VERSION,
      pathScore: PATHSCORE_VERSION,
      blind: BLIND_VERSION,
    },
    formulas: FORMULA_TEXT,
    dataset: s.dataset.info,
    anchor: s.anchor,
    terms: s.terms.map((t) => {
      const h = s.hits[t.id];
      const enc = termEncoding(t);
      return {
        id: t.id,
        label: t.label,
        value: t.value,
        kind: t.kind,
        encoding: t.encoding,
        rule: enc.rule,
        code: enc.code,
        mode: t.mode,
        fibK: t.fibK ?? null,
        count: h?.count ?? null,
        expected: h?.expected ?? null,
        truncated: h?.truncated ?? false,
      };
    }),
    keyHits: [...interesting].map((k) => {
      const at = k.lastIndexOf('@');
      const termId = k.slice(0, at);
      const n = Number(k.slice(at + 1));
      const code = s.hits[termId]?.code ?? '';
      const p = mapIndex(n);
      return {
        key: k,
        termId,
        n,
        digits: digitsAt(s.digits, n, code.length),
        face: faceSignLabel(faceBits(p)),
        P5: toP5(n, linkTs.get(k) ?? null),
        confidence: 'koodattu osuma',
        userNote: s.notes[k] ?? null,
      };
    }),
    preregistrations: s.prereg,
    tests: s.runs.map((r, i) => ({ ...r, qBH: q[i], pBonferroni: b[i] })),
    multipleComparisons: {
      testsRun: s.runs.length,
      note: 'Raportoi kaikki ajetut testit. Jälkikäteen valitut löydöt ovat eksploratiivisia.',
    },
    events: s.events,
    audit: s.audit,
    interpretationNotes: s.notes,
    matrix: {
      versions: { matrix: MATRIX_VERSION, ops369: OPS369_VERSION, jump: JUMP_VERSION, routeTest: ROUTE_TEST_VERSION },
      note:
        'Tarinamalli (story) ja reittien tulkinnat ovat käyttäjän symbolista tietoa, eivät matemaattisia havaintoja. ' +
        'Reittien π-faktat (mathFacts) on tarkistettu lähdeaineistosta tallennushetkellä.',
      story: s.matrix.story,
      direction: s.matrix.direction,
      currentTrail: s.matrix.trail.map((st) => ({ key: nodeKey(st.ref), via: st.via })),
      savedRoutes: s.matrix.saved.map((r) => ({ ...r, trail: r.trail.map((st) => ({ key: nodeKey(st.ref), via: st.via })) })),
      routeLocks: s.matrix.locks,
      routeRuns: s.matrix.routeRuns.map((r, i) => ({ ...r, qBH: routeQ[i] })),
      multipleComparisons: {
        routeTestsRun: Math.max(s.matrix.runIndex.total, s.matrix.routeRuns.length),
        routeRunsStored: s.matrix.routeRuns.length,
        routeRunIndex: s.matrix.runIndex,
        note: 'Matriisin reittitestit ovat oma testiperheensä (BH-q yllä). Jälkikäteen valitut reitit ovat eksploratiivisia.',
      },
      log: s.matrix.log,
    },
    pathDiscovery: {
      versions: { path: PATH_VERSION, pathScore: PATHSCORE_VERSION, blind: BLIND_VERSION },
      note:
        'Kolme osaa pidetään erillään: laskettu piin rakenne (reitit, numerot, indeksit, säännöt, tarkistukset), käyttäjän ' +
        'symbolinen tulkinta (lähtö- ja tavoitetekstit, tunnisteiden merkitys) ja testattu ennustetulos (sokkotesti samoilla ' +
        'parametreilla). Pelkkä reitin löytyminen ei ole näyttöä. Jokaisen ajon SHA-256 laskettiin kanonisesta kyselystä ennen ' +
        `moottorikutsua. "${EXPLORATORY_LABEL}" = asetukset valittiin saman kyselyn tulosten näkemisen jälkeen.`,
      pathScoreDefinition: PATHSCORE_DEFINITION,
      pathScoreDisclaimer: PATHSCORE_DISCLAIMER,
      form: pth.form,
      runs: pth.runs.map((r) => ({ ...r, qBH: pathQ.get(r.id) ?? null })),
      savedResults: pth.saved,
      blindRuns: pth.blindRuns.map((r) => ({ ...r, qBH: pathQ.get(r.id) ?? null })),
      multipleComparisons: {
        pathSearches: pth.counts.searches,
        nullComparisons: pth.counts.nulls,
        blindTests: pth.counts.blinds,
        total: pathM,
        exploratoryRuns: pth.runs.filter((r) => r.exploratory).length + pth.blindRuns.filter((r) => r.exploratory).length,
        note: 'Kaikki polkuhaut, satunnaisvertailut ja sokkotestit lasketaan (myös keskeytetyt). BH-q käyttää m = total ja olettaa puuttuvat p-arvot ykkösiksi.',
      },
    },
  };
}

export function hitsCsv(): string {
  const s = store.get();
  const rows = ['term,label,encoding,code,n,length,face,x,y,z,delta_n_anchor'];
  for (const t of s.terms) {
    const h = s.hits[t.id];
    if (!h || h.status !== 'ready') continue;
    for (const n of h.hits) {
      const p = mapIndex(n);
      rows.push(
        [t.id, JSON.stringify(t.label), t.encoding, h.code, n, h.code.length, faceSignLabel(faceBits(p)), p.x.toFixed(9), p.y.toFixed(9), p.z.toFixed(9), n - s.anchor.n].join(','),
      );
    }
  }
  return rows.join('\n');
}
