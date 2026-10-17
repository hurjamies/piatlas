// Path Discovery: tunnisteiden koodaus, poiminta tekstistä ja aikarajaus. Määrittely: docs/POLKUHAKU.md §1–2.
//
// Tunnisteet ovat käyttäjän hyväksymiä. Tekstistä poimitaan vain tarinassa tunnetut nimet (lähtötunnisteet ja
// henkilöt) täsmä- tai alkuosavastaavuudella; mitään muuta ei keksitä. Koodaussäännöt ovat samat kuin muualla
// sovelluksessa (PIATLAS-ENC-1.0.0): nimet ja sanat T9:llä suomalaisella translitteroinnilla (sama kuin t9Code),
// numerojonot sellaisenaan ja päivämäärät valitussa muodossa (dateToDigits).

import type { DateFormat } from '../encodings';
import { dateToDigits, encodeRawDetailed, encodeT9Detailed } from '../encodings';
import type { StoryModel } from '../matrix/types';
import { normName } from '../matrix/types';
import type { EncodedIdentifier, IdentifierRole, PathIdentifier, PathQuery } from './types';

/** Tarina ja tapahtumat, joista tunnisteita poimitaan. Symbolista tietoa: ei koskaan hakusärmiä. */
export interface IdentifierContext {
  story: StoryModel;
  events: { id: string; title: string; date: string; personIds?: string[] }[];
}

export const DEFAULT_DATE_FORMAT: DateFormat = 'DDMMYYYY';

/** Roolien kiinteä järjestys (näyttö ja kanonisointi). */
export const ROLE_ORDER: readonly IdentifierRole[] = ['lähtö', 'tavoite', 'tunnettu'];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Onko merkkijono todellinen kalenteripäivä muodossa VVVV-KK-PP (karkausvuodet huomioiden). */
export function isValidIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}

function identifierName(id: PathIdentifier): string {
  return id.label?.trim() || id.value?.trim() || id.id;
}

// ------------------------------------------------------------------ koodaus

/**
 * Tunnisteen koodi ja koodauksen kuvaus.
 *  - nimi, sana, henkilö: T9, Å,Ä → A ja Ö → O (sama kuin t9Code); kuvaus esim. "T9: H=4 A=2 N=6 N=6 A=2 (…)"
 *  - numerojono: raaka numerojono (välit, pisteet, viivat ja kaksoispisteet ohitetaan)
 *  - päivämäärä, tapahtuma: ISO-päivä (VVVV-KK-PP) valitussa muodossa, oletus DDMMYYYY
 * Virheet suomeksi. Ei koskaan heitä poikkeusta.
 */
export function encodeIdentifier(id: PathIdentifier): EncodedIdentifier {
  const value = (id.value ?? '').trim();
  const fail = (rule: string, error: string): EncodedIdentifier => ({ identifier: id, ok: false, code: '', rule, error });
  const ok = (code: string, rule: string): EncodedIdentifier => ({ identifier: id, ok: true, code, rule, error: null });
  switch (id.kind) {
    case 'nimi':
    case 'sana':
    case 'henkilö': {
      if (!value) return fail('T9', `Tunnisteen ${identifierName(id)} arvo on tyhjä.`);
      const r = encodeT9Detailed(normName(value), { scandi: 'fi-translit' });
      const letters = r.steps.map((s) => `${s.ch}=${s.out}`).join(' ');
      const rule = `T9: ${letters || '–'} (${r.rule.replace(/^T9: /, '')})`;
      if (!r.ok) return fail(rule, `${identifierName(id)}: ${r.errors.join(' ')}`);
      return ok(r.code, rule);
    }
    case 'numerojono': {
      if (!value) return fail('Raaka numerojono', `Tunnisteen ${identifierName(id)} arvo on tyhjä.`);
      const r = encodeRawDetailed(value);
      if (!r.ok) return fail(r.rule, `${identifierName(id)}: ${r.errors.join(' ')}`);
      return ok(r.code, r.rule);
    }
    case 'päivämäärä':
    case 'tapahtuma': {
      const fmt = id.dateFormat ?? DEFAULT_DATE_FORMAT;
      const base = `Päivämäärä muodossa ${fmt}`;
      if (!value) {
        return fail(
          base,
          id.kind === 'tapahtuma'
            ? `Tapahtumalla ${identifierName(id)} ei ole päivämäärää (VVVV-KK-PP), joten sitä ei voi koodata.`
            : `Tunnisteen ${identifierName(id)} arvo on tyhjä.`,
        );
      }
      if (!isValidIsoDate(value)) {
        return fail(base, `${identifierName(id)}: "${value}" ei ole kelvollinen päivämäärä muodossa VVVV-KK-PP.`);
      }
      const code = dateToDigits(value, fmt);
      if (!code) return fail(base, `${identifierName(id)}: päivämäärää "${value}" ei voi muuntaa muotoon ${fmt}.`);
      return ok(code, `Päivämäärä ${value} muodossa ${fmt}: ${code}`);
    }
    default:
      return fail('–', `Tuntematon tunnisteen tyyppi "${String((id as { kind: unknown }).kind)}".`);
  }
}

// ------------------------------------------------------------------ poiminta tekstistä

/** Tarinan tunnetut nimet: lähtötunnisteet ja henkilöt (normName), kumpikin kerran, määrittelyjärjestyksessä. */
export function storyNames(story: StoryModel): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const k = normName(s);
    if (k && !out.includes(k)) out.push(k);
  };
  for (const i of story.identifiers) add(i.name);
  for (const p of story.persons) add(p.name);
  return out;
}

const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;

/**
 * Poimii tekstistä tarinan tunnetut nimet (lähtötunnisteet ja henkilöt). Sana kelpaa, jos se on nimi
 * kokonaan (normName-vertailu) tai alkaa nimellä (taivutusmuodot: "Hannan" → HANNA). Täsmävastaavuus voittaa,
 * muuten pisin nimi, jolla sana alkaa. Tuntemattomat sanat ohitetaan: mitään ei keksitä. Sama nimi vain kerran
 * (ensimmäisen esiintymän järjestyksessä). Käyttäjä hyväksyy ja täydentää listan.
 */
export function extractIdentifiers(text: string, role: IdentifierRole, ctx: IdentifierContext): PathIdentifier[] {
  const names = storyNames(ctx.story);
  if (!names.length || !text) return [];
  const exact = new Set(names);
  const byLength = [...names].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const out: PathIdentifier[] = [];
  const seen = new Set<string>();
  for (const tok of text.normalize('NFC').match(TOKEN) ?? []) {
    const t = normName(tok);
    let name: string | null = exact.has(t) ? t : null;
    if (!name) name = byLength.find((n) => t.startsWith(n)) ?? null;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const persons = ctx.story.persons.filter((p) => normName(p.name) === name);
    out.push({
      id: `teksti:${role}:${name}`,
      role,
      kind: 'nimi',
      label: name,
      value: name,
      personId: persons.length === 1 ? persons[0].id : null,
      eventId: null,
      origin: 'teksti',
    });
  }
  return out;
}

// ------------------------------------------------------------------ aikarajaus

/**
 * Tapahtumatunnisteen päivämäärä: tunnisteen oma arvo (se koodataan), tai jos se ei ole kelvollinen päivämäärä,
 * kontekstin tapahtuman päivämäärä. null, jos kumpaakaan ei ole.
 */
function eventDateOf(id: PathIdentifier, ctx: IdentifierContext | null): string | null {
  const v = (id.value ?? '').trim();
  if (isValidIsoDate(v)) return v;
  const e = id.eventId && ctx ? ctx.events.find((x) => x.id === id.eventId) : undefined;
  return e && isValidIsoDate(e.date) ? e.date : null;
}

/**
 * Aikarajaus: jättää pois tapahtumatunnisteet, joiden päivämäärä on rajauksen ulkopuolella (rajat mukaan lukien).
 * Muut tunnisteet säilyvät aina, koska piin indekseillä ei ole kalenteriaikaa. Palauttaa huomautukset suomeksi.
 * ctx voi olla null (kanonisointi): silloin käytetään vain tunnisteen omaa arvoa.
 */
export function identifiersForTimeRange(
  ids: readonly PathIdentifier[],
  ctx: IdentifierContext | null,
  range: PathQuery['timeRange'],
): { identifiers: PathIdentifier[]; notes: string[] } {
  const notes: string[] = [];
  if (!range || (range.from == null && range.to == null)) return { identifiers: [...ids], notes };
  let from = range.from;
  let to = range.to;
  if (from != null && !isValidIsoDate(from)) {
    notes.push(`Aikarajauksen alku "${from}" ei ole muotoa VVVV-KK-PP; alkurajaa ei käytetty.`);
    from = null;
  }
  if (to != null && !isValidIsoDate(to)) {
    notes.push(`Aikarajauksen loppu "${to}" ei ole muotoa VVVV-KK-PP; loppurajaa ei käytetty.`);
    to = null;
  }
  if (from == null && to == null) return { identifiers: [...ids], notes };
  notes.push(
    `Aikarajaus ${from ?? '…'} – ${to ?? '…'} koskee vain tapahtumatunnisteita. Piin indekseillä ei ole kalenteriaikaa, ` +
      'joten rajaus ei vaikuta piin indekseihin.',
  );
  const kept: PathIdentifier[] = [];
  for (const id of ids) {
    if (id.kind !== 'tapahtuma') {
      kept.push(id);
      continue;
    }
    const title = (id.eventId && ctx?.events.find((e) => e.id === id.eventId)?.title) || identifierName(id);
    const date = eventDateOf(id, ctx);
    if (date == null) {
      notes.push(`Tapahtuman ${title} päivämäärä puuttuu tai on virheellinen; aikarajausta ei voitu soveltaa.`);
      kept.push(id);
      continue;
    }
    if ((from != null && date < from) || (to != null && date > to)) {
      notes.push(`Tapahtuma ${title} (${date}) jätettiin pois: aikarajauksen ulkopuolella.`);
      continue;
    }
    kept.push(id);
  }
  return { identifiers: kept, notes };
}

// ------------------------------------------------------------------ lähtö- ja tavoitejoukon vertailu

export type CodeLike = PathIdentifier | EncodedIdentifier | string;

function codeOf(x: CodeLike): string | null {
  if (typeof x === 'string') return x || null;
  if ('identifier' in x) return x.ok ? x.code : null;
  const e = encodeIdentifier(x);
  return e.ok ? e.code : null;
}

/** Kelvollisten koodien joukko (koodausvirheelliset ohitetaan). */
export function codeSet(xs: readonly CodeLike[]): Set<string> {
  const s = new Set<string>();
  for (const x of xs) {
    const c = codeOf(x);
    if (c) s.add(c);
  }
  return s;
}

/**
 * Koodautuvatko lähtö- ja tavoitetila samaksi tunnistejoukoksi (koodien mukaan)? Tyhjä joukko ei ole "sama":
 * silloin vertailtavaa ei ole.
 */
export function sameIdentifierSets(start: readonly CodeLike[], goal: readonly CodeLike[]): boolean {
  const a = codeSet(start);
  const b = codeSet(goal);
  if (!a.size || a.size !== b.size) return false;
  for (const c of a) if (!b.has(c)) return false;
  return true;
}

/** Varoitus docs/POLKUHAKU.md §1: haku ei voi erottaa samoiksi koodautuvia tiloja. */
export function sameSetsWarning(labels: readonly string[]): string {
  const what = labels.length ? ` (${labels.join(', ')})` : '';
  return (
    `Lähtö- ja tavoitetila koodautuvat samaksi tunnistejoukoksi${what}, joten haku ei voi erottaa niitä. ` +
    'Anna tavoitteelle oma tunniste (esim. sana tai päivämäärä).'
  );
}
