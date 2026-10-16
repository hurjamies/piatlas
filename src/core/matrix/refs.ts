// Viitekoodit: tarinan lähtötunnisteiden ja henkilöiden nimien T9-koodit. Näistä etsitään naapureita ja
// 369-operaatioiden osumia. Lista näytetään aina tuloksen yhteydessä, jotta haku on toistettavissa.

import { encodeT9Detailed } from '../encodings';
import type { StoryModel } from './types';
import { normName } from './types';

export interface RefCode {
  name: string;
  code: string;
}

/** Nimen T9-koodi (suomalainen translitterointi Å,Ä→A, Ö→O). null, jos nimeä ei voi koodata. */
export function t9Code(name: string): string | null {
  const r = encodeT9Detailed(normName(name), { scandi: 'fi-translit' });
  return r.ok ? r.code : null;
}

/** Lähtötunnisteet ensin (niiden ilmoitettu koodi), sitten henkilöiden nimet. Sama koodi vain kerran. */
export function referenceCodes(model: StoryModel): RefCode[] {
  const out: RefCode[] = [];
  const seen = new Set<string>();
  const push = (name: string, code: string | null) => {
    if (!code || seen.has(code)) return;
    seen.add(code);
    out.push({ name: normName(name), code });
  };
  for (const id of model.identifiers) push(id.name, t9Code(id.name));
  for (const p of model.persons) push(p.name, t9Code(p.name));
  return out;
}
