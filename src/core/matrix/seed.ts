// Ensimmäisen testitapauksen tarinadata (tehtävänanto 2026-10-16). Kaikki tämä on käyttäjän antamaa
// symbolista tietoa. Päivämääriä ei keksitä: ajanjaksot ovat null, kunnes käyttäjä antaa ne.
// Hanna I, II ja III ovat kolme eri henkilöä, vaikka nimen T9-koodi on sama (42662).

import type { Gloss, HypothesisMeta, Person, StoryModel, StoryPath } from './types';

export const SEED_VERSION = 'story-seed-2026-10-16';
const T0 = '2026-10-16T00:00:00.000Z';

const unknownTiming: HypothesisMeta = {
  timing: 'ei-tiedossa',
  statedAt: T0,
  lockHash: null,
  note: 'Tuotu tehtävänannosta. Ei tiedetä, muodostettiinko polku ennen vai jälkeen aiempien π-löytöjen.',
};

function person(id: string, name: string, homonymOrdinal: number | null, description: string, roles: string[] = []): Person {
  return { id, name, homonymOrdinal, description, roles, period: null, source: 'tehtävänanto', createdAt: T0 };
}

function gloss(id: string, symbol: string, meanings: string[], context: Gloss['context'], extra: Partial<Gloss> = {}): Gloss {
  return { id, symbol, meanings, context, personId: null, name: null, note: '', source: 'tehtävänanto', createdAt: T0, ...extra };
}

export function createSeedStory(): StoryModel {
  const persons: Person[] = [
    person('matti', 'MATTI', null, 'Lähtötunniste MATTI (62884).'),
    // Kuvaukset pidetään neutraaleina, koska julkaistu sivu on julkinen. Käyttäjä kirjoittaa omat kuvauksensa
    // sovelluksessa, ja ne tallentuvat vain laitteelle.
    person('hanna-1', 'HANNA', 1, 'Ensimmäinen Hanna (kronologisesti).'),
    person('hanna-2', 'HANNA', 2, 'Toinen Hanna (kronologisesti).'),
    person('hanna-3', 'HANNA', 3, 'Nykyinen Hanna.', ['Maxin äiti']),
    person('salla', 'SALLA', null, 'Lähtötunniste SALLA (72552).'),
    person('ida', 'IDA', null, 'Lähtöankkuri IDA (432).'),
    person('max', 'MAX', null, 'Lähtötunniste MAX (629).'),
  ];

  const paths: StoryPath[] = [
    {
      id: 'polku-a',
      title: 'Polku A',
      theme: 'sukupolvien jatkuvuus',
      steps: [
        { name: 'MATTI', personId: 'matti', symbol: '6', stage: '' },
        { name: 'HANNA', personId: 'hanna-3', symbol: '2', stage: '' },
        { name: 'MAX', personId: 'max', symbol: '9', stage: '' },
      ],
      note: 'Numerot 6-2-9 on johdettu MAXin T9-koodista 629. Polun ja koodin yhtäläisyys on rakenteellinen, ei löydös.',
      source: 'tehtävänanto',
      hypothesis: unknownTiming,
      createdAt: T0,
    },
    {
      id: 'polku-b',
      title: 'Polku B',
      theme: 'ihmissuhteiden kehityspolku',
      steps: [
        { name: 'HANNA', personId: 'hanna-3', symbol: '2', stage: 'siirtymä' },
        { name: 'SALLA', personId: 'salla', symbol: '3', stage: 'kokemus, kriisi' },
        { name: 'IDA', personId: 'ida', symbol: '4', stage: 'integraatio, uusi tila' },
      ],
      note: 'Hanna-askel on asetettu testireitin mukaan HANNA III:een. Käyttäjä voi vaihtaa henkilön.',
      source: 'tehtävänanto',
      hypothesis: unknownTiming,
      createdAt: T0,
    },
  ];

  const glosses: Gloss[] = [
    gloss('g-23', '23', ['hälytys', 'vaikeudet', 'tuntematon', 'ahdistus'], { kind: 'tarina' }),
    gloss('g-43', '43', ['toivo', 'oma suunta', 'totuus'], { kind: 'tarina' }),
    gloss('g-2-tarina', '2', ['siirtymä'], { kind: 'tarina' }),
    gloss('g-3-tarina', '3', ['kokemus', 'kriisi'], { kind: 'tarina' }),
    gloss('g-4-tarina', '4', ['integraatio', 'uusi tila'], { kind: 'tarina' }),
    gloss('g-629-6', '6', ['MATTI'], { kind: 'koodi', code: '629' }, { personId: 'matti', name: 'MATTI' }),
    gloss('g-629-2', '2', ['HANNA'], { kind: 'koodi', code: '629' }, { personId: 'hanna-3', name: 'HANNA' }),
    gloss('g-629-9', '9', ['MAX'], { kind: 'koodi', code: '629' }, { personId: 'max', name: 'MAX' }),
    gloss('g-b-2', '2', ['HANNA', 'siirtymä'], { kind: 'polku', pathId: 'polku-b' }, { personId: 'hanna-3', name: 'HANNA' }),
    gloss('g-b-3', '3', ['SALLA', 'polun kolmas vaihe'], { kind: 'polku', pathId: 'polku-b' }, { personId: 'salla', name: 'SALLA' }),
    gloss('g-b-4', '4', ['IDA', 'integraatio'], { kind: 'polku', pathId: 'polku-b' }, { personId: 'ida', name: 'IDA' }),
  ];

  return {
    version: 1,
    seedVersion: SEED_VERSION,
    identifiers: [
      { name: 'IDA', code: '432', encoding: 'T9', reportedPositions: [858511], reportedBy: 'tehtävänanto (lähtöankkuri)' },
      { name: 'MATTI', code: '62884', encoding: 'T9', reportedPositions: [858260], reportedBy: 'PI ATLAS MVP-1 (README)' },
      { name: 'HANNA', code: '42662', encoding: 'T9', reportedPositions: [], reportedBy: 'tehtävänanto' },
      { name: 'SALLA', code: '72552', encoding: 'T9', reportedPositions: [], reportedBy: 'tehtävänanto' },
      { name: 'MAX', code: '629', encoding: 'T9', reportedPositions: [], reportedBy: 'tehtävänanto' },
      { name: 'MINI', code: '6464', encoding: 'T9', reportedPositions: [858960], reportedBy: 'PI ATLAS MVP-1 (README)' },
    ],
    persons,
    relations: [{ id: 'r-hanna3-max', from: 'hanna-3', to: 'max', kind: 'äiti', note: '', source: 'tehtävänanto' }],
    glosses,
    paths,
  };
}
