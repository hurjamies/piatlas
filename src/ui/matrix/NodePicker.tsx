// Solmuvalitsin (Matriisi-välilehti): numero, nimi, henkilö, tulkinta, polku, tapahtuma tai π-indeksi. Valittu solmu
// lisätään nykyisen murupolun loppuun askeleena "valittu käyttäjän toimesta". Askel ei ole laskettu yhteys
// edelliseen solmuun (src/state/matrix-select.ts), joten aiempi polku säilyy eikä yhteyttä keksitä.
import { useMemo, useState } from 'react';
import type { MatrixEnv } from '../../core/matrix/types';
import { REALM_LABELS } from '../../core/matrix/types';
import { openSelectedNode } from '../../state/matrix-actions';
import { fmtN } from '../format';
import { pickCandidates } from './picker';

export function NodePicker({ env }: { env: MatrixEnv }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const N = env.digits.length;
  const { items, total } = useMemo(
    () => (open ? pickCandidates(q, env.story, env.events, N) : { items: [], total: 0 }),
    [open, q, env.story, env.events, N],
  );
  return (
    <details className="mx-picker" data-testid="matrix-picker" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="mx-picker-head">
          <span className="mx-picker-title">Valitse solmu</span>
          <span className="mx-small faint">numero, nimi, henkilö, tulkinta, polku, tapahtuma tai π-indeksi</span>
        </span>
      </summary>
      <div className="mx-picker-body">
        <input
          className="input"
          id="mx-picker-q"
          data-testid="matrix-picker-input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label="Hae solmua: numero, nimi, henkilö, tulkinta, polku, tapahtuma tai π-indeksi (@n)"
          placeholder="esim. 23, HANNA tai @858511"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mx-small faint">
          Numerojono avaa koodin (yksi numero myös sen tulkinnat), @n avaa π-indeksin. Valinta lisätään murupolun loppuun
          askeleena ”valittu käyttäjän toimesta”: se ei ole laskettu yhteys edelliseen solmuun.
        </div>
        <div className="mx-picker-list" aria-label="Valittavat solmut">
          {items.map((c) => (
            <button
              key={c.key}
              type="button"
              className="mx-pick"
              data-testid="matrix-pick"
              data-key={c.key}
              onClick={() => {
                openSelectedNode(c.ref, 'solmuvalitsin');
                setOpen(false);
                setQ('');
              }}
            >
              <span className={`mx-dot r-${c.realm}`} aria-hidden="true" />
              <span className="mx-pick-main">
                <span className="mx-pick-title">{c.title}</span>
                <span className="mx-pick-hint">{c.hint}</span>
              </span>
              <span className={`mx-chip realm r-${c.realm}`}>{REALM_LABELS[c.realm]}</span>
            </button>
          ))}
          {!items.length && (
            <div className="mx-small muted">
              Ei vastaavia solmuja. π-indeksi on välillä @1…@{fmtN(N)}; nimen voi kirjoittaa sellaisenaan.
            </div>
          )}
          {total > items.length && (
            <div className="mx-small faint">
              Näytetään {fmtN(items.length)}/{fmtN(total)}. Tarkenna hakua.
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
