// Matriisin avaukset, jotka eivät kulje laskettua särmää pitkin: käyttäjän valitsema solmu (solmuvalitsin, Tarina-sivu,
// tapahtumapaneeli) ja hakutermin osuma toisesta näkymästä. Molemmat lisätään nykyisen polun loppuun näkyvänä
// askeleena, joten aiempi polku säilyy. Askel EI ole laskettu eikä tarinamallista johdettu yhteys: ryhmä ja
// jäljitys kertovat sen, eikä askelta näytetä koskaan expand()-särmänä. Lisäksi tarkistus tapahtumien
// henkilölinkeistä, kun tarina korvataan. Puhtaat funktiot (ei Reactia eikä storea): tests/matrix-state.test.ts.

import { fmtIndex } from '../core/matrix/expand';
import { verifyHit } from '../core/matrix/hits';
import { personLabel } from '../core/matrix/story';
import { openEdge, type OpenResult } from '../core/matrix/trail';
import type { MatrixEdge, MatrixEvent, NodeRef, StoryModel, TrailStep } from '../core/matrix/types';
import { nodeKey, realmOf } from '../core/matrix/types';
import { hitFact, OPENED_FROM_HIT_GROUP } from './matrix';

/** Ryhmä askeleelle, jonka käyttäjä valitsi käsin (ei laskettu yhteys edelliseen solmuun). */
export const SELECTED_BY_USER_GROUP = 'Valittu käyttäjän toimesta';

/**
 * Murupolun askel käyttäjän valitsemaan solmuun. Taso seuraa kohteen kerrosta (π-data → matemaattinen,
 * tarinaverkko → symbolinen), ja kerrosvaihto lasketaan todellisista kerroksista. Jäljitys kertoo, ettei askel
 * ole laskettu yhteys.
 */
export function selectionEdge(from: NodeRef, to: NodeRef, title: string, source: string): MatrixEdge {
  const realm = realmOf(to);
  return {
    to,
    layer: realm === 'pi' ? 'matemaattinen' : 'symbolinen',
    group: SELECTED_BY_USER_GROUP,
    relation: `valittu käyttäjän toimesta (${source}): ${title}`,
    trace:
      `Käyttäjä valitsi solmun ${nodeKey(to)} käsin (${source}). Tämä ei ole laskettu eikä tarinamallista johdettu ` +
      `yhteys edelliseen solmuun ${nodeKey(from)}: askel kirjaa vain, että solmu avattiin valitsemalla.`,
    crossesRealm: realmOf(from) !== realm,
  };
}

/**
 * Valittu solmu nykyisen polun loppuun. Polulla jo oleva solmu katkaisee polun siihen ('palattu'), ja syvyysraja
 * estää lisäyksen ('syvyysraja'), kuten tavallisessa avauksessa. Syötettä ei muuteta.
 */
export function appendSelected(trail: TrailStep[], to: NodeRef, title: string, source: string): { trail: TrailStep[]; result: OpenResult } {
  const from = trail.length ? trail[trail.length - 1].ref : ({ kind: 'root' } as NodeRef);
  return openEdge(trail, selectionEdge(from, to, title, source));
}

/**
 * Hakutermin osuma nykyisen polun loppuun askeleena "avattu osumasta" (ryhmä OPENED_FROM_HIT_GROUP). Osuma
 * tarkistetaan lähdeaineistosta, ja jäljitys kertoo, ettei askel ole laskettu yhteys edelliseen solmuun.
 * Polulla jo oleva osuma katkaisee polun siihen ('palattu'); syvyysraja estää lisäyksen.
 */
export function appendHitStep(
  trail: TrailStep[],
  digits: string,
  code: string,
  n: number,
  sourceLabel: string,
): { trail: TrailStep[]; result: OpenResult } {
  const from = trail.length ? trail[trail.length - 1].ref : ({ kind: 'root' } as NodeRef);
  const ok = verifyHit(digits, code, n);
  const edge: MatrixEdge = {
    to: { kind: 'hit', code, n },
    layer: 'matemaattinen',
    group: OPENED_FROM_HIT_GROUP,
    relation: `avattu osumasta: hakutermi ${sourceLabel} @${fmtIndex(n)}`,
    trace:
      `${hitFact(digits, code, n)}. Käyttäjä avasi osuman hakutermin ${sourceLabel} osumasta toisessa näkymässä. ` +
      `Tämä ei ole laskettu yhteys edelliseen solmuun ${nodeKey(from)}: osuma lisättiin polun loppuun, jotta aiempi ` +
      `polku säilyy.${ok ? '' : ' Osuma ei täsmää lähdeaineistoon.'}`,
    crossesRealm: realmOf(from) !== 'pi',
  };
  return openEdge(trail, edge);
}

/** Tapahtuma, jonka henkilölinkeistä osa viittaa henkilöihin, joita uudessa tarinassa ei ole. */
export interface DanglingEventLinks {
  eventId: string;
  title: string;
  /** Uudesta tarinasta puuttuvat henkilötunnukset (tapahtuman järjestyksessä). */
  personIds: string[];
}

/** Henkilölinkin nimi nykyisestä tarinasta: "AINO (henkilo-…)", tai pelkkä tunnus, jos henkilöä ei ole. */
export function personLinkLabel(story: StoryModel, id: string): string {
  return story.persons.some((p) => p.id === id) ? `${personLabel(story, id)} (${id})` : id;
}

/** Tapahtumat, joiden personIds viittaa henkilöihin, joita `next`-tarinassa ei ole (tarinan palautus tai tuonti). */
export function danglingEventPersons(events: MatrixEvent[], next: StoryModel): DanglingEventLinks[] {
  const ids = new Set(next.persons.map((p) => p.id));
  const out: DanglingEventLinks[] = [];
  for (const e of events) {
    const gone = [...new Set(e.personIds ?? [])].filter((id) => !ids.has(id));
    if (gone.length) out.push({ eventId: e.id, title: e.title, personIds: gone });
  }
  return out;
}
