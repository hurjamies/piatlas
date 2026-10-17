import { useState } from 'react';
import { comparePersons, personLabel } from '../../core/matrix/story';
import { parseHitKey } from '../../core/types';
import { addEvent, openPanel, removeEvent, select, toggleEventLink, updateEvent } from '../../state/actions';
import { openSelectedNode, toggleEventPerson } from '../../state/matrix-actions';
import { useApp } from '../../state/store';
import { fmtDate, fmtN } from '../format';

export function EventsPanel() {
  const events = useApp((s) => s.events);
  const terms = useApp((s) => s.terms);
  const sel = useApp((s) => s.selection);
  const story = useApp((s) => s.matrix.story);
  const persons = [...story.persons].sort(comparePersons);
  const known = new Set(story.persons.map((p) => p.id));
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const termOf = (id: string) => terms.find((t) => t.id === id);
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <div className="note">
        Elämäntapahtumat ovat <b>sinun antamaasi kalenteriaikaa</b>. Niitä ei kytketä osumiin automaattisesti. Linkitä
        tapahtuma osumaan itse, jolloin osuma saa P5-arvon (x, y, z, n, aikaleima).
      </div>
      <form
        className="card section"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || !date) return;
          addEvent({ title: title.trim(), date, note });
          setTitle('');
          setDate('');
          setNote('');
        }}
      >
        <div className="eyebrow">Uusi tapahtuma</div>
        <label className="field">
          <span>OTSIKKO</span>
          <input id="ev-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="esim. Idan syntymä" />
        </label>
        <label className="field">
          <span>PÄIVÄMÄÄRÄ</span>
          <input id="ev-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>MUISTIINPANO</span>
          <textarea id="ev-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={!title.trim() || !date}>
          Tallenna tapahtuma
        </button>
      </form>
      {sorted.length === 0 && <div className="muted">Ei tapahtumia vielä.</div>}
      {sorted.map((e) => (
        <div key={e.id} className="card section" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{e.title}</b>
            <span className="mono muted">{fmtDate(e.date)}</span>
          </div>
          {e.note && <div className="muted" style={{ fontSize: 13 }}>{e.note}</div>}
          <div className="row">
            {e.linkedHits.length === 0 && <span className="faint" style={{ fontSize: 12.5 }}>Ei linkitettyjä osumia.</span>}
            {e.linkedHits.map((k) => {
              const r = parseHitKey(k);
              const t = r ? termOf(r.termId) : undefined;
              return r ? (
                <button key={k} className="chip" onClick={() => select(r)}>
                  <span className="swatch" style={{ background: t?.color }} /> {t?.label ?? r.termId} @{fmtN(r.n)}
                </button>
              ) : null;
            })}
          </div>
          <div className="ev-persons" aria-label="Tarinamatriisin henkilöt">
            <span className="faint" style={{ fontSize: 12 }}>
              Henkilöt (tarinaverkko):{' '}
              {(e.personIds ?? []).length
                ? (e.personIds ?? []).map((id) => personLabel(story, id)).join(', ')
                : 'ei liitetty'}
            </span>
            <div className="row" style={{ gap: 6 }}>
              {persons.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="toggle ev-person"
                  aria-pressed={(e.personIds ?? []).includes(p.id)}
                  onClick={() => toggleEventPerson(e.id, p.id)}
                >
                  <span className="dot" /> {personLabel(story, p)}
                </button>
              ))}
              {/* Linkki henkilöön, jota tarinassa ei enää ole (esim. tarina korvattiin): poistettavissa. */}
              {[...new Set(e.personIds ?? [])]
                .filter((id) => !known.has(id))
                .map((id) => (
                  <button
                    key={`gone-${id}`}
                    type="button"
                    className="toggle ev-person ev-person-gone"
                    data-testid="event-person-gone"
                    aria-pressed="true"
                    aria-label={`Poista linkki henkilöön ${id} (poistettu tarinasta)`}
                    title="Henkilöä ei ole enää tarinassa. Napauta poistaaksesi linkin."
                    onClick={() => toggleEventPerson(e.id, id)}
                  >
                    <span className="dot" /> {id} (poistettu) ×
                  </button>
                ))}
            </div>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn small"
              data-testid="event-open-matrix"
              onClick={() => {
                openSelectedNode({ kind: 'event', eventId: e.id }, 'tapahtumapaneeli');
                openPanel(null);
              }}
            >
              Avaa matriisissa
            </button>
            {sel && (
              <button className="btn small" onClick={() => toggleEventLink(e.id, sel)}>
                {e.linkedHits.includes(`${sel.termId}@${sel.n}`) ? 'Poista linkki valittuun' : 'Linkitä valittuun osumaan'}
              </button>
            )}
            <input
              aria-label="Muuta päivämäärää"
              className="input"
              type="date"
              style={{ maxWidth: 170, minHeight: 34 }}
              value={e.date.slice(0, 10)}
              onChange={(ev) => updateEvent(e.id, { date: ev.target.value })}
            />
            {confirm === e.id ? (
              <>
                <button className="btn small danger" onClick={() => removeEvent(e.id)}>
                  Poista
                </button>
                <button className="btn small ghost" onClick={() => setConfirm(null)}>
                  Peru
                </button>
              </>
            ) : (
              <button className="btn small danger" onClick={() => setConfirm(e.id)}>
                Poista
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
