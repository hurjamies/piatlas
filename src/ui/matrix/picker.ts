// Solmuvalitsimen haku (puhdas funktio, ei Reactia): numerojono → koodisolmu (yksi numero → myös sen
// tulkinnat), "@n" tai numerojono aineiston rajoissa → π-indeksi, teksti → nimi, henkilöt, tulkinnat, polut ja
// tapahtumat. Tyhjä haku listaa tarinan henkilöt, tulkinnat, polut ja tapahtumat. Haku ei laske yhteyksiä: valittu
// solmu avataan murupolkuun askeleena "valittu käyttäjän toimesta" (src/state/matrix-select.ts).
// Testataan tests/matrix-state.test.ts:ssä.

import { fmtIndex } from '../../core/matrix/expand';
import { t9Code } from '../../core/matrix/refs';
import { comparePersons, glossContextLabel, personLabel } from '../../core/matrix/story';
import type { MatrixEvent, NodeRef, Realm, StoryModel } from '../../core/matrix/types';
import { nodeKey, normName, realmOf } from '../../core/matrix/types';
import { shortLabel } from './labels';

export interface PickCandidate {
  ref: NodeRef;
  key: string;
  title: string;
  /** Solmun tyyppi ja lisätieto, esim. "tulkinta · tarina (käyttäjän tulkinta)". */
  hint: string;
  realm: Realm;
}

export const PICK_LIMIT = 40;

const fold = (s: string) => s.normalize('NFC').toLocaleLowerCase('fi');

/** Hakua vastaavat solmut. `N` = aineiston pituus (π-indeksin raja). `total` = osumia ennen rajausta. */
export function pickCandidates(
  query: string,
  story: StoryModel,
  events: MatrixEvent[],
  N: number,
  limit = PICK_LIMIT,
): { items: PickCandidate[]; total: number } {
  const q = query.normalize('NFC').trim();
  const out: PickCandidate[] = [];
  const seen = new Set<string>();
  const push = (ref: NodeRef, hint: string) => {
    const key = nodeKey(ref);
    if (ref.kind === 'root' || seen.has(key)) return;
    seen.add(key);
    out.push({ ref, key, title: shortLabel(ref, story, events), hint, realm: realmOf(ref) });
  };
  const position = (n: number) => {
    if (Number.isSafeInteger(n) && n >= 1 && n <= N) push({ kind: 'position', n }, `π-indeksi · kohta @${fmtIndex(n)} aineistossa`);
  };
  const done = () => ({ items: out.slice(0, Math.max(0, limit)), total: out.length });

  // "@858511", "@ 858 511" tai "n = 858511": vain π-indeksi.
  const pos = /^(?:@|n\s*=?)\s*(\d[\d\s]*)$/i.exec(q);
  if (pos) {
    position(Number(pos[1].replace(/\s/g, '')));
    return done();
  }

  // Numerojono: koodisolmu, saman symbolin tulkinnat (myös yksi numero) ja π-indeksi, jos se on aineiston rajoissa.
  if (/^\d[\d\s]*$/.test(q)) {
    const code = q.replace(/\s/g, '');
    push({ kind: 'code', code }, `koodi · π-data · ${code.length} ${code.length === 1 ? 'numero' : 'numeroa'}`);
    for (const g of story.glosses)
      if (g.symbol === code) push({ kind: 'gloss', glossId: g.id }, `tulkinta · symboli ${g.symbol} · ${glossContextLabel(story, g.context)}`);
    for (const g of story.glosses)
      if (g.context.kind === 'koodi' && g.context.code === code)
        push({ kind: 'gloss', glossId: g.id }, `tulkinta · symboli ${g.symbol} · ${glossContextLabel(story, g.context)}`);
    if (!/^0/.test(code)) position(Number(code));
    return done();
  }

  const f = fold(q);
  const has = (...xs: (string | null | undefined)[]) => !f || xs.some((x) => x != null && fold(x).includes(f));

  // Teksti: kirjoitettu nimi ja tarinan nimet, jotka sisältävät haun.
  if (f && /\p{L}/u.test(q)) {
    const names = [normName(q)];
    for (const id of story.identifiers) names.push(normName(id.name));
    for (const p of story.persons) names.push(normName(p.name));
    for (const p of story.paths) for (const s of p.steps) names.push(normName(s.name));
    for (const name of names)
      if (name && has(name)) {
        const code = t9Code(name);
        push({ kind: 'name', name }, `nimi · ${code ? `T9 ${code}` : 'ei koodattavissa T9:llä'}`);
      }
  }
  for (const p of [...story.persons].sort(comparePersons))
    if (has(p.name, personLabel(story, p), p.description, p.id, ...p.roles))
      push({ kind: 'person', personId: p.id }, `henkilö · ${p.description || p.roles.join(', ') || p.id}`);
  for (const g of story.glosses)
    if (has(g.symbol, g.name, g.id, glossContextLabel(story, g.context), ...g.meanings))
      push({ kind: 'gloss', glossId: g.id }, `tulkinta · symboli ${g.symbol} · ${glossContextLabel(story, g.context)}`);
  for (const p of story.paths)
    if (has(p.title, p.theme, p.id)) push({ kind: 'path', pathId: p.id }, `polku · ${p.theme || '–'} · ${p.steps.length} askelta`);
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date)))
    if (has(e.title, e.date)) push({ kind: 'event', eventId: e.id }, `tapahtuma · ${e.date || 'ei päivämäärää'}`);
  return done();
}
