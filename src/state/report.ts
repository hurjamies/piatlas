// Tutkimusraportin vienti: JSON (kaikki toistamiseen tarvittava) ja CSV (osumat).

import { digitsAt } from '../core/digits';
import { mapIndex, faceBits, faceSignLabel, toP5 } from '../core/mapping';
import { benjaminiHochberg, bonferroni } from '../core/stats';
import { eventTimestamp, hitKey, termEncoding } from '../core/types';
import { ENCODING_VERSION, FORMULA_TEXT, FORMULA_VERSION, NET_VERSION, STATS_VERSION } from '../core/version';
import { store } from './store';

declare const __APP_VERSION__: string;

export function buildReport() {
  const s = store.get();
  const ps = s.runs.map((r) => r.summary.pValue);
  const q = benjaminiHochberg(ps);
  const b = bonferroni(ps);
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
    versions: { formula: FORMULA_VERSION, encoding: ENCODING_VERSION, stats: STATS_VERSION, net: NET_VERSION },
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
