// Tarinamallin puhtaat apufunktiot ja muuttumattomat muokkausoperaatiot. Määrittely: docs/MATRIISI.md §3–4, §8.
// Kaikki tässä on käyttäjän antamaa symbolista tietoa (tarinakerros). Ainoa π-kerroksen kosketus on
// verifyIdentifiers, joka tarkistaa ilmoitetut sijainnit suoraan lähdeaineistosta.
// Mikään funktio ei muuta syötettään: muokkaukset palauttavat aina uuden mallin.

import { digitsAt } from '../digits';
import { codeHits, expectedHits, verifyHit } from './hits';
import { t9Code } from './refs';
import type { Direction, Gloss, GlossContext, MatrixEvent, PathStep, Person, Relation, StoryModel, StoryPath } from './types';
import { normName, toRoman } from './types';

// ------------------------------------------------------------------ haku

export function getPerson(model: StoryModel, id: string): Person | null {
  return model.persons.find((p) => p.id === id) ?? null;
}

export function getPath(model: StoryModel, id: string): StoryPath | null {
  return model.paths.find((p) => p.id === id) ?? null;
}

export function getGloss(model: StoryModel, id: string): Gloss | null {
  return model.glosses.find((g) => g.id === id) ?? null;
}

function cmpStr(a: string | null | undefined, b: string | null | undefined): number {
  const an = a == null || a === '';
  const bn = b == null || b === '';
  if (an && bn) return 0;
  if (an) return 1; // tuntematon viimeiseksi
  if (bn) return -1;
  return a! < b! ? -1 : a! > b! ? 1 : 0;
}

function cmpOrd(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // null viimeiseksi
  if (b == null) return -1;
  return a - b;
}

/** Samannimisten järjestys: järjestysnumero (null viimeiseksi), ajanjakson alku, luontiaika, tunnus. */
export function comparePersons(a: Person, b: Person): number {
  return (
    cmpOrd(a.homonymOrdinal, b.homonymOrdinal) ||
    cmpStr(a.period?.start, b.period?.start) ||
    cmpStr(a.createdAt, b.createdAt) ||
    cmpStr(a.id, b.id)
  );
}

/** Henkilöt, joiden nimi on `name` (normName-vertailu), samannimisten järjestyksessä. */
export function personsByName(model: StoryModel, name: string): Person[] {
  const key = normName(name);
  return model.persons.filter((p) => normName(p.name) === key).sort(comparePersons);
}

/**
 * Näyttönimi: "HANNA III", kun samaa nimeä kantaa 2+ henkilöä ja järjestysnumero on asetettu, muuten pelkkä nimi.
 * Tuntematon tunnus → "<id> (poistettu)".
 */
export function personLabel(model: StoryModel, personOrId: Person | string): string {
  const p = typeof personOrId === 'string' ? getPerson(model, personOrId) : personOrId;
  if (!p) return `${personOrId as string} (poistettu)`;
  const name = normName(p.name);
  const same = model.persons.filter((q) => normName(q.name) === name).length;
  if (same >= 2 && p.homonymOrdinal != null) return `${name} ${toRoman(p.homonymOrdinal)}`;
  return name;
}

export type ChronologyBasis = 'ajanjakso' | 'järjestysnumero' | 'yksi';

export const CHRONOLOGY_LABELS: Record<ChronologyBasis, string> = {
  ajanjakso: 'ajanjaksojen alkupäivät (kaikilla henkilöillä on ajanjakso)',
  järjestysnumero: 'samannimisten järjestysnumerot (ajanjakso ei ole tiedossa kaikille)',
  yksi: 'nimellä on enintään yksi henkilö',
};

/**
 * Ristiriita samannimisten järjestysnumeroiden ja ajanjaksojen välillä. Tarkistetaan vain, kun jokaisella
 * samannimisellä on sekä järjestysnumero että period.start. Ristiriita = jokin pari, jossa pienempi järjestysnumero
 * alkaa myöhemmin (sama alkupäivä ei ole ristiriita). Palauttaa varoitustekstin tai null. Numeroita ei muuteta.
 */
export function homonymOrdinalConflict(model: StoryModel, name: string): string | null {
  const persons = personsByName(model, name);
  if (persons.length < 2) return null;
  if (!persons.every((p) => p.homonymOrdinal != null && !!p.period?.start)) return null;
  const byOrd = [...persons].sort((a, b) => a.homonymOrdinal! - b.homonymOrdinal!);
  let conflict = false;
  for (let i = 0; i < byOrd.length && !conflict; i++)
    for (let j = i + 1; j < byOrd.length; j++)
      if (byOrd[i].homonymOrdinal! < byOrd[j].homonymOrdinal! && byOrd[i].period!.start! > byOrd[j].period!.start!) {
        conflict = true;
        break;
      }
  if (!conflict) return null;
  const byStart = [...persons].sort((a, b) => cmpStr(a.period!.start, b.period!.start) || comparePersons(a, b));
  const key = normName(name);
  return (
    `Nimi ${key}: järjestysnumerot (${byOrd.map((p) => personLabel(model, p)).join(' → ')}) ovat eri järjestyksessä kuin ` +
    `ajanjaksojen alkupäivät (${byStart.map((p) => `${personLabel(model, p)} ${p.period!.start}`).join(' → ')}). ` +
    'Järjestysnumero tarkoittaa samannimisten kronologista järjestystä: tarkista numerot tai päivämäärät. Numeroita ei muuteta automaattisesti.'
  );
}

/**
 * Samannimisten kronologia. Peruste 'ajanjakso' vain, jos jokaisella on period.start; muuten järjestysnumerot.
 * 'yksi', kun henkilöitä on enintään yksi. `conflict`: varoitus, jos järjestysnumerot ja ajanjaksot ovat
 * ristiriidassa (homonymOrdinalConflict), muuten null.
 */
export function homonymChronology(
  model: StoryModel,
  name: string,
): { persons: Person[]; basis: ChronologyBasis; conflict: string | null } {
  const persons = personsByName(model, name);
  if (persons.length <= 1) return { persons, basis: 'yksi', conflict: null };
  const conflict = homonymOrdinalConflict(model, name);
  if (persons.every((p) => !!p.period?.start)) {
    const sorted = [...persons].sort((a, b) => cmpStr(a.period!.start, b.period!.start) || comparePersons(a, b));
    return { persons: sorted, basis: 'ajanjakso', conflict };
  }
  return { persons, basis: 'järjestysnumero', conflict };
}

// ------------------------------------------------------------------ polut

export interface PathOccurrence {
  path: StoryPath;
  /** Askeleen indeksi polun määrittelyjärjestyksessä (0-pohjainen). */
  index: number;
}

/** Jokainen askel, jonka personId on henkilö. Henkilö voi olla monella polulla ja samalla polulla useasti. */
export function pathsOfPerson(model: StoryModel, personId: string): PathOccurrence[] {
  const out: PathOccurrence[] = [];
  for (const path of model.paths)
    path.steps.forEach((s, index) => {
      if (s.personId === personId) out.push({ path, index });
    });
  return out;
}

/** Askeleet, joiden nimi on `name` (henkilöstä riippumatta). */
export function pathsOfName(model: StoryModel, name: string): PathOccurrence[] {
  const key = normName(name);
  const out: PathOccurrence[] = [];
  for (const path of model.paths)
    path.steps.forEach((s, index) => {
      if (normName(s.name) === key) out.push({ path, index });
    });
  return out;
}

/** '234' = määrittelyjärjestys, '432' = käänteinen. Palauttaa aina uuden taulukon. */
export function stepsInDirection(path: StoryPath, dir: Direction): PathStep[] {
  const s = [...path.steps];
  return dir === '234' ? s : s.reverse();
}

/** Askeleet indeksin jälkeen valittuun suuntaan (234: index+1…loppu; 432: index−1…0). */
export function continuation(path: StoryPath, index: number, dir: Direction): PathStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= path.steps.length) return [];
  return dir === '234' ? path.steps.slice(index + 1) : path.steps.slice(0, index).reverse();
}

/** Askeleet, jotka johtavat indeksiin valitussa suunnassa (234: 0…index−1; 432: loppu…index+1). */
export function leadingSteps(path: StoryPath, index: number, dir: Direction): PathStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= path.steps.length) return [];
  return dir === '234' ? path.steps.slice(0, index) : path.steps.slice(index + 1).reverse();
}

/** Askelten symbolit yhteen kirjoitettuna valitussa suunnassa (polku B: '234' / '432'). */
export function symbolString(path: StoryPath, dir: Direction): string {
  return stepsInDirection(path, dir)
    .map((s) => s.symbol)
    .join('');
}

export interface JunctionBranch {
  path: StoryPath;
  index: number;
  /** Askeleet, jotka johtavat henkilöön valitussa suunnassa. */
  before: PathStep[];
  /** Jatko henkilön jälkeen valitussa suunnassa. */
  after: PathStep[];
}

/**
 * Polkujen yhdistys henkilössä. Jokaiselle polulle (ja jokaiselle henkilön esiintymälle polulla) haara,
 * jossa edeltävät ja seuraavat askeleet valitussa suunnassa. `missing`: polut, joita ei ole tai joilla
 * henkilö ei esiinny. Alkuperäisiä polkuja ei muuteta.
 */
export function junction(
  model: StoryModel,
  personId: string,
  pathIds: string[],
  dir: Direction,
): { branches: JunctionBranch[]; missing: string[] } {
  const branches: JunctionBranch[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of pathIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const path = getPath(model, id);
    if (!path) {
      missing.push(id);
      continue;
    }
    let found = false;
    path.steps.forEach((s, index) => {
      if (s.personId !== personId) return;
      found = true;
      branches.push({ path, index, before: leadingSteps(path, index, dir), after: continuation(path, index, dir) });
    });
    if (!found) missing.push(id);
  }
  return { branches, missing };
}

// ------------------------------------------------------------------ tulkinnat

export type GlossMatch = 'sama-konteksti' | 'tarina' | 'muu-konteksti';

export function sameGlossContext(a: GlossContext, b: GlossContext): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'koodi') return a.code === (b as { code: string }).code;
  if (a.kind === 'polku') return a.pathId === (b as { pathId: string }).pathId;
  return true;
}

/**
 * Kaikki symbolin tulkinnat: ensin täsmälleen sama konteksti, sitten käyttäjän tarinan yleiset ('tarina'),
 * sitten muut kontekstit. Mitään ei muuteta yleispäteväksi merkitykseksi: jokainen tulos kantaa kontekstinsa.
 */
export function glossesFor(
  model: StoryModel,
  symbol: string,
  ctx: GlossContext | null,
): { gloss: Gloss; match: GlossMatch }[] {
  const rank: Record<GlossMatch, number> = { 'sama-konteksti': 0, tarina: 1, 'muu-konteksti': 2 };
  return model.glosses
    .filter((g) => g.symbol === symbol)
    .map((gloss) => {
      const match: GlossMatch =
        ctx && sameGlossContext(gloss.context, ctx) ? 'sama-konteksti' : gloss.context.kind === 'tarina' ? 'tarina' : 'muu-konteksti';
      return { gloss, match };
    })
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => rank[a.match] - rank[b.match] || a.i - b.i)
    .map(({ gloss, match }) => ({ gloss, match }));
}

/** "koodi 629", "Polku B · ihmissuhteiden kehityspolku", "tarina (käyttäjän tulkinta)". */
export function glossContextLabel(model: StoryModel, ctx: GlossContext): string {
  switch (ctx.kind) {
    case 'tarina':
      return 'tarina (käyttäjän tulkinta)';
    case 'koodi':
      return `koodi ${ctx.code}`;
    case 'polku': {
      const p = getPath(model, ctx.pathId);
      return p ? `${p.title} · ${p.theme}` : `polku ${ctx.pathId} (poistettu)`;
    }
  }
}

// ------------------------------------------------------------------ validointi

function duplicates(ids: string[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
  return new Map([...count].filter(([, c]) => c > 1));
}

/** Tarinamallin rakenteelliset virheet suomeksi. Tyhjä lista = malli on eheä. */
export function validateStory(model: StoryModel): string[] {
  const errors: string[] = [];
  const kinds: [string, string[]][] = [
    ['Henkilön', model.persons.map((p) => p.id)],
    ['Polun', model.paths.map((p) => p.id)],
    ['Tulkinnan', model.glosses.map((g) => g.id)],
    ['Suhteen', model.relations.map((r) => r.id)],
  ];
  for (const [label, ids] of kinds)
    for (const [id, c] of duplicates(ids)) errors.push(`${label} tunnus "${id}" on käytössä ${c} kertaa.`);

  const personIds = new Set(model.persons.map((p) => p.id));
  const pathIds = new Set(model.paths.map((p) => p.id));

  for (const p of model.persons) {
    if (!normName(p.name)) errors.push(`Henkilön "${p.id}" nimi puuttuu.`);
    if (p.homonymOrdinal != null && (!Number.isInteger(p.homonymOrdinal) || p.homonymOrdinal < 1))
      errors.push(`Henkilön "${p.id}" järjestysnumero ${p.homonymOrdinal} ei ole positiivinen kokonaisluku.`);
  }

  for (const path of model.paths) {
    path.steps.forEach((s, i) => {
      const where = `Polku "${path.title}" (${path.id}), askel ${i + 1}`;
      if (!normName(s.name)) errors.push(`${where}: nimi puuttuu.`);
      if (!s.symbol || !s.symbol.trim()) errors.push(`${where}: symboli puuttuu.`);
      if (s.personId != null) {
        const p = getPerson(model, s.personId);
        if (!p) errors.push(`${where}: tuntematon henkilö "${s.personId}".`);
        else if (normName(p.name) !== normName(s.name))
          errors.push(`${where}: henkilön "${p.id}" nimi on ${normName(p.name)}, mutta askeleen nimi on ${normName(s.name)}.`);
      }
    });
  }

  for (const g of model.glosses) {
    const where = `Tulkinta "${g.id}"`;
    if (!g.symbol || !g.symbol.trim()) errors.push(`${where}: symboli puuttuu.`);
    if (g.personId != null) {
      const p = getPerson(model, g.personId);
      if (!p) errors.push(`${where}: tuntematon henkilö "${g.personId}".`);
      else if (g.name != null && normName(g.name) !== normName(p.name))
        errors.push(`${where}: henkilön "${p.id}" nimi on ${normName(p.name)}, mutta tulkinnan nimi on ${normName(g.name)}.`);
    }
    if (g.context.kind === 'polku' && !pathIds.has(g.context.pathId))
      errors.push(`${where}: konteksti viittaa tuntemattomaan polkuun "${g.context.pathId}".`);
    if (g.context.kind === 'koodi' && !/^\d+$/.test(g.context.code))
      errors.push(`${where}: kontekstin koodi "${g.context.code}" ei ole numerojono.`);
  }

  for (const r of model.relations) {
    if (!personIds.has(r.from)) errors.push(`Suhde "${r.id}": tuntematon lähtöhenkilö "${r.from}".`);
    if (!personIds.has(r.to)) errors.push(`Suhde "${r.id}": tuntematon kohdehenkilö "${r.to}".`);
  }

  const groups = new Map<string, Person[]>();
  for (const p of model.persons) {
    const k = normName(p.name);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  for (const [name, group] of groups) {
    if (group.length === 1) {
      const p = group[0];
      if (p.homonymOrdinal != null)
        errors.push(
          `Nimi ${name}: vain yhdellä henkilöllä on tämä nimi, joten järjestysnumeroa ei käytetä (henkilö "${p.id}": ${p.homonymOrdinal}).`,
        );
      continue;
    }
    for (const p of group)
      if (p.homonymOrdinal == null)
        errors.push(`Nimi ${name}: ${group.length} henkilöllä on sama nimi, mutta henkilöltä "${p.id}" puuttuu järjestysnumero.`);
    const byOrd = new Map<number, string[]>();
    for (const p of group)
      if (p.homonymOrdinal != null) byOrd.set(p.homonymOrdinal, [...(byOrd.get(p.homonymOrdinal) ?? []), p.id]);
    for (const [ord, ids] of byOrd)
      if (ids.length > 1) errors.push(`Nimi ${name}: järjestysnumero ${ord} on usealla henkilöllä (${ids.join(', ')}).`);
  }
  return errors;
}

/**
 * Tarinamallin varoitukset suomeksi: sisällölliset ristiriidat, jotka eivät riko rakennetta (validateStory
 * palauttaa vain virheet). Nyt: samannimisten järjestysnumerot vs. ajanjaksojen alkupäivät.
 */
export function validateStoryWarnings(model: StoryModel): string[] {
  const warnings: string[] = [];
  const names: string[] = [];
  for (const p of model.persons) {
    const k = normName(p.name);
    if (k && !names.includes(k)) names.push(k);
  }
  for (const name of names) {
    const w = homonymOrdinalConflict(model, name);
    if (w) warnings.push(w);
  }
  return warnings;
}

// ------------------------------------------------------------------ muokkaus (muuttumaton)

/**
 * Antaa samannimisille järjestysnumerot 1…k säilyttäen nykyisen keskinäisen järjestyksen
 * (järjestysnumero, sitten ajanjakson alku, sitten luontiaika). Yksi henkilö saa null.
 * `priorityId`: jos tällä henkilöllä on järjestysnumero k, hänet siirretään kohtaan k: hänet otetaan ryhmästä,
 * muut järjestetään, ja hänet lisätään indeksiin k − 1 (rajattuna 0…muiden määrä). Siirto toimii molempiin
 * suuntiin (esim. HANNA I → 3 ja HANNA III → 1). upsertPerson käyttää tätä.
 */
export function assignHomonymOrdinals(model: StoryModel, name: string, priorityId?: string | null): StoryModel {
  const key = normName(name);
  const group = model.persons.filter((p) => normName(p.name) === key);
  const ordinal = new Map<string, number | null>();
  if (group.length === 1) ordinal.set(group[0].id, null);
  else if (group.length > 1) {
    const order = (a: Person, b: Person) =>
      cmpOrd(a.homonymOrdinal, b.homonymOrdinal) ||
      cmpStr(a.period?.start, b.period?.start) ||
      cmpStr(a.createdAt, b.createdAt) ||
      cmpStr(a.id, b.id);
    // Pyydetty paikka vain annetulle numerolle; numeroton henkilö ei ohita muita.
    const moved = priorityId != null ? group.find((p) => p.id === priorityId && p.homonymOrdinal != null) : undefined;
    const sorted = group.filter((p) => p !== moved).sort(order);
    if (moved) {
      const k = Number.isFinite(moved.homonymOrdinal) ? Math.round(moved.homonymOrdinal!) : sorted.length + 1;
      sorted.splice(Math.min(Math.max(k - 1, 0), sorted.length), 0, moved);
    }
    sorted.forEach((p, i) => ordinal.set(p.id, i + 1));
  }
  return {
    ...model,
    persons: model.persons.map((p) =>
      ordinal.has(p.id) && ordinal.get(p.id) !== p.homonymOrdinal ? { ...p, homonymOrdinal: ordinal.get(p.id)! } : p,
    ),
  };
}

function copyPerson(p: Person): Person {
  return { ...p, name: normName(p.name), roles: [...p.roles], period: p.period ? { ...p.period } : null };
}

/**
 * Lisää tai korvaa henkilön (tunnuksen mukaan) ja numeroi samannimiset uudelleen. Jos nimi vaihtuu,
 * numeroidaan sekä vanha että uusi nimiryhmä, ja henkilön vanha järjestysnumero hylätään (sillä ei ole
 * merkitystä uudessa ryhmässä): hänet sijoitetaan uuteen ryhmään ajanjakson ja luontiajan mukaan.
 * Polkujen askeleita ja tulkintoja ei muuteta; validateStory ilmoittaa, jos askeleen nimi ei enää täsmää.
 */
export function upsertPerson(model: StoryModel, person: Person): StoryModel {
  const prev = getPerson(model, person.id);
  let next = copyPerson(person);
  const renamed = !!prev && normName(prev.name) !== next.name;
  if (renamed) next = { ...next, homonymOrdinal: null };
  const persons = prev ? model.persons.map((p) => (p.id === person.id ? next : p)) : [...model.persons, next];
  let m: StoryModel = { ...model, persons };
  if (renamed) m = assignHomonymOrdinals(m, prev!.name);
  return assignHomonymOrdinals(m, next.name, renamed ? null : next.id);
}

/** Viittaukset henkilöön (polut, tulkinnat, suhteet, tapahtumat) luettavina kuvauksina. */
export function personReferences(model: StoryModel, personId: string, events: MatrixEvent[] = []): string[] {
  const refs: string[] = [];
  for (const path of model.paths)
    path.steps.forEach((s, i) => {
      if (s.personId === personId) refs.push(`${path.title} (askel ${i + 1})`);
    });
  for (const g of model.glosses) if (g.personId === personId) refs.push(`tulkinta "${g.id}"`);
  for (const r of model.relations) if (r.from === personId || r.to === personId) refs.push(`suhde "${r.id}" (${r.kind})`);
  for (const e of events) if (e.personIds?.includes(personId)) refs.push(`tapahtuma "${e.title}" (${e.id})`);
  return refs;
}

/**
 * Poistaa henkilön, jos mikään ei viittaa häneen. Muuten palauttaa alkuperäisen mallin ja virheilmoituksen,
 * jossa viittaukset luetellaan. Tapahtumat eivät kuulu tarinamalliin, joten ne annetaan erikseen.
 */
export function removePerson(
  model: StoryModel,
  personId: string,
  events: MatrixEvent[] = [],
): { model: StoryModel; error: string | null } {
  const p = getPerson(model, personId);
  if (!p) return { model, error: `Henkilöä "${personId}" ei löydy.` };
  const refs = personReferences(model, personId, events);
  if (refs.length)
    return {
      model,
      error: `Henkilöä ${personLabel(model, p)} ei voi poistaa, koska häneen viitataan: ${refs.join(', ')}. Poista tai vaihda viittaukset ensin.`,
    };
  const m: StoryModel = { ...model, persons: model.persons.filter((q) => q.id !== personId) };
  return { model: assignHomonymOrdinals(m, p.name), error: null };
}

function copyGloss(g: Gloss): Gloss {
  return {
    ...g,
    symbol: g.symbol.trim(),
    meanings: [...g.meanings],
    context: { ...g.context },
    name: g.name != null ? normName(g.name) : g.name,
  };
}

export function upsertGloss(model: StoryModel, gloss: Gloss): StoryModel {
  const next = copyGloss(gloss);
  const exists = model.glosses.some((g) => g.id === gloss.id);
  return {
    ...model,
    glosses: exists ? model.glosses.map((g) => (g.id === gloss.id ? next : g)) : [...model.glosses, next],
  };
}

export function removeGloss(model: StoryModel, glossId: string): StoryModel {
  return { ...model, glosses: model.glosses.filter((g) => g.id !== glossId) };
}

function copyPath(p: StoryPath): StoryPath {
  return {
    ...p,
    steps: p.steps.map((s) => ({ ...s, name: normName(s.name), symbol: s.symbol.trim() })),
    hypothesis: { ...p.hypothesis },
  };
}

export function upsertPath(model: StoryModel, path: StoryPath): StoryModel {
  const next = copyPath(path);
  const exists = model.paths.some((p) => p.id === path.id);
  return { ...model, paths: exists ? model.paths.map((p) => (p.id === path.id ? next : p)) : [...model.paths, next] };
}

/** Poistaa polun, ellei jokin tulkinta käytä sitä kontekstinaan. */
export function removePath(model: StoryModel, pathId: string): { model: StoryModel; error: string | null } {
  const path = getPath(model, pathId);
  if (!path) return { model, error: `Polkua "${pathId}" ei löydy.` };
  const users = model.glosses.filter((g) => g.context.kind === 'polku' && g.context.pathId === pathId).map((g) => `"${g.id}"`);
  if (users.length)
    return {
      model,
      error: `Polkua ${path.title} ei voi poistaa, koska tulkinnat ${users.join(', ')} käyttävät sitä kontekstinaan. Poista tai siirrä tulkinnat ensin.`,
    };
  return { model: { ...model, paths: model.paths.filter((p) => p.id !== pathId) }, error: null };
}

export function upsertRelation(model: StoryModel, relation: Relation): StoryModel {
  const next = { ...relation };
  const exists = model.relations.some((r) => r.id === relation.id);
  return {
    ...model,
    relations: exists ? model.relations.map((r) => (r.id === relation.id ? next : r)) : [...model.relations, next],
  };
}

export function removeRelation(model: StoryModel, relationId: string): StoryModel {
  return { ...model, relations: model.relations.filter((r) => r.id !== relationId) };
}

// ------------------------------------------------------------------ lähtötunnisteiden tarkistus (π-kerros)

export interface IdentifierCheck {
  name: string;
  /** Ilmoitettu koodi (Identifier.code). */
  reportedCode: string;
  /** T9(nimi). null, jos nimeä ei voi koodata. */
  computedCode: string | null;
  codeOk: boolean;
  /** Osumien määrä aineistossa (T9(nimi), tai ilmoitettu koodi, jos nimeä ei voi koodata). */
  count: number;
  /** Odotettu määrä tasajakautuneessa satunnaisjonossa: (N − L + 1) / 10^L. */
  expected: number;
  /** Ilmoitetut sijainnit: löytyneet numerot ja tarkistuksen tulos. */
  positions: { n: number; found: string; ok: boolean }[];
  ok: boolean;
}

/**
 * Tarkistaa lähtötunnisteet lähdeaineistosta (§8): koodi = T9(nimi) ja digits[n − 1 … n + L − 2] === koodi.
 * Sijainnit tarkistetaan nimen todellista T9-koodia vasten (ilmoitettua koodia vasten vain, jos nimeä ei voi
 * koodata). Ristiriita ilmoitetussa koodissa näkyy kentässä codeOk, ja kumpikin virhe tekee tuloksesta ok = false.
 */
export function verifyIdentifiers(digits: string, model: StoryModel): IdentifierCheck[] {
  return model.identifiers.map((id) => {
    const computedCode = t9Code(id.name);
    const code = computedCode ?? id.code;
    const codeOk = computedCode !== null && computedCode === id.code;
    const L = code.length;
    const positions = id.reportedPositions.map((n) => ({
      n,
      found: Number.isInteger(n) && n >= 1 ? digitsAt(digits, n, L) : '',
      ok: verifyHit(digits, code, n),
    }));
    return {
      name: normName(id.name),
      reportedCode: id.code,
      computedCode,
      codeOk,
      count: /^\d+$/.test(code) ? codeHits(digits, code).length : 0,
      expected: expectedHits(digits.length, L),
      positions,
      ok: codeOk && positions.every((p) => p.ok),
    };
  });
}
