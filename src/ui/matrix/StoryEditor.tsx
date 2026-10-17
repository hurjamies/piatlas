// Tarina-sivu: henkilöt, suhteet, tulkinnat ja polut. Muokkaukset tehdään ydinkirjaston muuttumattomilla
// operaatioilla (upsertPerson, removePerson, …), ja poistot, joihin viitataan, estetään ydinkirjaston virheellä.
// Kaikki tämä on käyttäjän symbolista tietoa, ja se tallentuu vain tälle laitteelle.
import { useMemo, useRef, useState } from 'react';
import { t9Code } from '../../core/matrix/refs';
import { comparePersons, glossContextLabel, personLabel, personsByName, validateStory, validateStoryWarnings } from '../../core/matrix/story';
import { createSeedStory } from '../../core/matrix/seed';
import type { Gloss, GlossContext, NodeRef, PathStep, Person, Relation, StoryModel, StoryPath } from '../../core/matrix/types';
import { HYPOTHESIS_LABELS, nodeKey, normName } from '../../core/matrix/types';
import { editedPathMeta, sanitizeStory } from '../../state/matrix';
import {
  deleteGloss,
  deletePath,
  deletePerson,
  deleteRelation,
  importStory,
  newId,
  openSelectedNode,
  resetStoryToSeed,
  saveGloss,
  savePath,
  savePerson,
  saveRelation,
} from '../../state/matrix-actions';
import { danglingEventPersons, personLinkLabel } from '../../state/matrix-select';
import { useApp } from '../../state/store';
import { copyText, downloadText, IS_ARTIFACT } from './bits';

const nowIso = () => new Date().toISOString();
const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function StoryEditor() {
  const story = useApp((s) => s.matrix.story);
  const errors = useMemo(() => validateStory(story), [story]);
  const warnings = useMemo(() => validateStoryWarnings(story), [story]);
  return (
    <div className="section mx-story" data-testid="matrix-story-editor">
      <div className="eyebrow rose">Tarinaverkko · käyttäjän symbolinen tieto</div>
      <div className="note" data-testid="matrix-story-local">
        Tarinatiedot tallentuvat vain tälle laitteelle. Ne eivät ole π-dataa eivätkä matemaattisia havaintoja.
      </div>
      {errors.length ? (
        <div className="note err" data-testid="matrix-story-errors">
          <b>Tarinan eheystarkistus: {errors.length} virhettä</b>
          <ul className="mx-errlist">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mx-small mx-ok-line">
          {warnings.length ? 'Tarinamallin rakenne on eheä (validateStory), mutta siinä on varoituksia.' : 'Tarinamalli on eheä ✓ (validateStory)'}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="note warn" data-testid="matrix-story-warnings">
          <b>Tarinan varoitukset: {warnings.length}</b>
          <ul className="mx-errlist">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <PersonsSection story={story} />
      <RelationsSection story={story} />
      <GlossesSection story={story} />
      <PathsSection story={story} />
      <StoryTools story={story} />
    </div>
  );
}

// ------------------------------------------------------------------ yhteiset

function RowButtons({
  onEdit,
  onDelete,
  confirming,
  setConfirming,
  open,
}: {
  onEdit: () => void;
  onDelete: () => void;
  confirming: boolean;
  setConfirming: (b: boolean) => void;
  /** Solmu matriisissa: lisätään murupolun loppuun askeleena "valittu käyttäjän toimesta" (ei laskettu yhteys). */
  open?: NodeRef;
}) {
  return (
    <div className="mx-btn-row">
      {open && (
        <button
          type="button"
          className="mx-btn"
          data-testid="matrix-story-open"
          data-key={nodeKey(open)}
          onClick={() => openSelectedNode(open, 'Tarina-sivu')}
        >
          Avaa matriisissa
        </button>
      )}
      <button type="button" className="mx-btn" onClick={onEdit}>
        Muokkaa
      </button>
      {confirming ? (
        <>
          <button type="button" className="mx-btn danger" onClick={onDelete}>
            Poista
          </button>
          <button type="button" className="mx-btn ghost" onClick={() => setConfirming(false)}>
            Peru
          </button>
        </>
      ) : (
        <button type="button" className="mx-btn danger" onClick={() => setConfirming(true)}>
          Poista
        </button>
      )}
    </div>
  );
}

function FormButtons({ onCancel, disabled }: { onCancel: () => void; disabled?: boolean }) {
  return (
    <div className="mx-btn-row">
      <button type="submit" className="mx-btn primary" disabled={disabled}>
        Tallenna
      </button>
      <button type="button" className="mx-btn ghost" onClick={onCancel}>
        Peru
      </button>
    </div>
  );
}

function PersonSelect({ story, value, onChange, allowNone, id }: { story: StoryModel; value: string; onChange: (v: string) => void; allowNone?: string; id?: string }) {
  return (
    <select className="input" id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone !== undefined && <option value="">{allowNone}</option>}
      {[...story.persons].sort(comparePersons).map((p) => (
        <option key={p.id} value={p.id}>
          {personLabel(story, p)} ({p.id})
        </option>
      ))}
    </select>
  );
}

// ------------------------------------------------------------------ henkilöt

function PersonsSection({ story }: { story: StoryModel }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sorted = [...story.persons].sort((a, b) => normName(a.name).localeCompare(normName(b.name), 'fi') || comparePersons(a, b));
  return (
    <details className="mx-story-sec" open>
      <summary>Henkilöt ({story.persons.length})</summary>
      <div className="mx-small faint">
        T9-koodi on nimen ominaisuus, ei henkilön: kaikilla samannimisillä on sama koodi. Samannimiset numeroidaan
        kronologisesti (HANNA I, II, III); numero ei ole symbolinen polkunumero.
      </div>
      {err && <div className="note err">{err}</div>}
      {sorted.map((p) =>
        editing === p.id ? (
          <PersonForm key={p.id} story={story} initial={p} onDone={() => setEditing(null)} />
        ) : (
          <div key={p.id} className="mx-item">
            <div className="mx-item-head">
              <b>{personLabel(story, p)}</b>
              <span className="mx-chip mono" title="Nimen T9-koodi (nimen ominaisuus, ei henkilön)">
                T9 {t9Code(p.name) ?? '–'}
              </span>
              <span className="mx-small faint mono">{p.id}</span>
            </div>
            <div className="mx-small">
              {p.description || '–'}
              {p.roles.length > 0 && <> · roolit: {p.roles.join(', ')}</>}
            </div>
            <div className="mx-small faint">
              ajanjakso: {p.period && (p.period.start || p.period.end) ? `${p.period.start ?? '?'} – ${p.period.end ?? ''}` : 'ei tiedossa'} · lähde: {p.source}
            </div>
            <RowButtons
              open={{ kind: 'person', personId: p.id }}
              onEdit={() => {
                setErr(null);
                setEditing(p.id);
              }}
              confirming={confirm === p.id}
              setConfirming={(b) => setConfirm(b ? p.id : null)}
              onDelete={() => {
                setErr(deletePerson(p.id));
                setConfirm(null);
              }}
            />
          </div>
        ),
      )}
      {editing === 'new' ? (
        <PersonForm story={story} initial={null} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="mx-btn" data-testid="matrix-add-person" onClick={() => setEditing('new')}>
          + Lisää henkilö
        </button>
      )}
    </details>
  );
}

function PersonForm({ story, initial, onDone }: { story: StoryModel; initial: Person | null; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [ordinal, setOrdinal] = useState(initial?.homonymOrdinal != null ? String(initial.homonymOrdinal) : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [roles, setRoles] = useState(initial?.roles.join(', ') ?? '');
  const [start, setStart] = useState(initial?.period?.start ?? '');
  const [end, setEnd] = useState(initial?.period?.end ?? '');
  const key = normName(name);
  const group = key ? personsByName(story, key).filter((p) => p.id !== initial?.id) : [];
  const code = key ? t9Code(key) : null;
  return (
    <form
      className="mx-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!key) return;
        const ord = Number(ordinal);
        savePerson({
          id: initial?.id ?? newId('henkilo'),
          name: key,
          homonymOrdinal: group.length && Number.isInteger(ord) && ord >= 1 ? ord : initial?.homonymOrdinal ?? null,
          description: description.trim(),
          roles: splitList(roles),
          period: start || end ? { start: start || null, end: end || null } : null,
          source: initial?.source ?? 'käyttäjä',
          createdAt: initial?.createdAt ?? nowIso(),
        });
        onDone();
      }}
    >
      <div className="mx-form-grid">
        <label className="field">
          <span>NIMI (KOODATTAVA)</span>
          <input className="input" id="mx-person-name" value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="characters" placeholder="esim. HANNA" />
        </label>
        {group.length > 0 && (
          <label className="field">
            <span>JÄRJESTYS SAMANNIMISISSÄ</span>
            <input className="input" inputMode="numeric" value={ordinal} onChange={(e) => setOrdinal(e.target.value)} placeholder={`1…${group.length + 1}`} />
          </label>
        )}
      </div>
      <div className="mx-small faint">
        {code ? `T9(${key}) = ${code}. Koodi on nimen ominaisuus, ei henkilön.` : key ? 'Nimeä ei voi koodata T9:llä.' : 'Anna nimi.'}
        {group.length > 0 && ` Nimellä on jo ${group.length} muuta henkilöä: näyttönimi saa roomalaisen järjestysnumeron.`}
      </div>
      <label className="field">
        <span>KUVAUS</span>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span>ROOLIT (PILKULLA EROTETTUNA)</span>
        <input className="input" value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="esim. Maxin äiti" />
      </label>
      <div className="mx-form-grid">
        <label className="field">
          <span>AJANJAKSO ALKAA</span>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>PÄÄTTYY</span>
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <FormButtons onCancel={onDone} disabled={!key} />
    </form>
  );
}

// ------------------------------------------------------------------ suhteet

function RelationsSection({ story }: { story: StoryModel }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <details className="mx-story-sec">
      <summary>Suhteet ({story.relations.length})</summary>
      {story.relations.map((r) =>
        editing === r.id ? (
          <RelationForm key={r.id} story={story} initial={r} onDone={() => setEditing(null)} />
        ) : (
          <div key={r.id} className="mx-item">
            <div className="mx-item-head">
              <b>
                {personLabel(story, r.from)} on henkilön {personLabel(story, r.to)} {r.kind || '–'}
              </b>
            </div>
            {r.note && <div className="mx-small">{r.note}</div>}
            <div className="mx-small faint mono">
              {r.id} · lähde: {r.source}
            </div>
            <RowButtons
              onEdit={() => setEditing(r.id)}
              confirming={confirm === r.id}
              setConfirming={(b) => setConfirm(b ? r.id : null)}
              onDelete={() => {
                deleteRelation(r.id);
                setConfirm(null);
              }}
            />
          </div>
        ),
      )}
      {editing === 'new' ? (
        <RelationForm story={story} initial={null} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="mx-btn" onClick={() => setEditing('new')} disabled={story.persons.length < 2}>
          + Lisää suhde
        </button>
      )}
    </details>
  );
}

function RelationForm({ story, initial, onDone }: { story: StoryModel; initial: Relation | null; onDone: () => void }) {
  const [from, setFrom] = useState(initial?.from ?? story.persons[0]?.id ?? '');
  const [to, setTo] = useState(initial?.to ?? story.persons[1]?.id ?? '');
  const [kind, setKind] = useState(initial?.kind ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  return (
    <form
      className="mx-form"
      onSubmit={(e) => {
        e.preventDefault();
        saveRelation({ id: initial?.id ?? newId('suhde'), from, to, kind: kind.trim(), note: note.trim(), source: initial?.source ?? 'käyttäjä' });
        onDone();
      }}
    >
      <label className="field">
        <span>HENKILÖ</span>
        <PersonSelect story={story} value={from} onChange={setFrom} />
      </label>
      <label className="field">
        <span>ON HENKILÖN … (LAJI, ESIM. ÄITI)</span>
        <input className="input" value={kind} onChange={(e) => setKind(e.target.value)} />
      </label>
      <label className="field">
        <span>KOHDEHENKILÖ</span>
        <PersonSelect story={story} value={to} onChange={setTo} />
      </label>
      <label className="field">
        <span>HUOMIO</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <FormButtons onCancel={onDone} disabled={!from || !to || from === to || !kind.trim()} />
    </form>
  );
}

// ------------------------------------------------------------------ tulkinnat

function GlossesSection({ story }: { story: StoryModel }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <details className="mx-story-sec">
      <summary>Tulkinnat ({story.glosses.length})</summary>
      <div className="mx-small faint">Tulkinta on aina kontekstisidonnainen (tarina, koodi tai polku), ei numeron yleispätevä merkitys.</div>
      {story.glosses.map((g) =>
        editing === g.id ? (
          <GlossForm key={g.id} story={story} initial={g} onDone={() => setEditing(null)} />
        ) : (
          <div key={g.id} className="mx-item">
            <div className="mx-item-head">
              <b className="mono">{g.symbol}</b>
              <span>= {g.meanings.join(', ') || '–'}</span>
            </div>
            <div className="mx-small">
              konteksti: {glossContextLabel(story, g.context)}
              {g.personId && ` · henkilö ${personLabel(story, g.personId)}`}
              {g.name && ` · nimi ${g.name}`}
            </div>
            <div className="mx-small faint mono">
              {g.id} · lähde: {g.source}
            </div>
            <RowButtons
              open={{ kind: 'gloss', glossId: g.id }}
              onEdit={() => setEditing(g.id)}
              confirming={confirm === g.id}
              setConfirming={(b) => setConfirm(b ? g.id : null)}
              onDelete={() => {
                deleteGloss(g.id);
                setConfirm(null);
              }}
            />
          </div>
        ),
      )}
      {editing === 'new' ? (
        <GlossForm story={story} initial={null} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="mx-btn" onClick={() => setEditing('new')}>
          + Lisää tulkinta
        </button>
      )}
    </details>
  );
}

function GlossForm({ story, initial, onDone }: { story: StoryModel; initial: Gloss | null; onDone: () => void }) {
  const [symbol, setSymbol] = useState(initial?.symbol ?? '');
  const [meanings, setMeanings] = useState(initial?.meanings.join(', ') ?? '');
  const [ctxKind, setCtxKind] = useState<GlossContext['kind']>(initial?.context.kind ?? 'tarina');
  const [code, setCode] = useState(initial?.context.kind === 'koodi' ? initial.context.code : '');
  const [pathId, setPathId] = useState(initial?.context.kind === 'polku' ? initial.context.pathId : story.paths[0]?.id ?? '');
  const [personId, setPersonId] = useState(initial?.personId ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const ctx: GlossContext | null =
    ctxKind === 'tarina' ? { kind: 'tarina' } : ctxKind === 'koodi' ? (/^\d+$/.test(code) ? { kind: 'koodi', code } : null) : pathId ? { kind: 'polku', pathId } : null;
  return (
    <form
      className="mx-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ctx || !symbol.trim()) return;
        saveGloss({
          id: initial?.id ?? newId('tulkinta'),
          symbol: symbol.trim(),
          meanings: splitList(meanings),
          context: ctx,
          personId: personId || null,
          name: name.trim() ? normName(name) : null,
          note: note.trim(),
          source: initial?.source ?? 'käyttäjä',
          createdAt: initial?.createdAt ?? nowIso(),
        });
        onDone();
      }}
    >
      <div className="mx-form-grid">
        <label className="field">
          <span>SYMBOLI (NUMERO)</span>
          <input className="input mono" inputMode="numeric" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="esim. 2" />
        </label>
        <label className="field">
          <span>KONTEKSTI</span>
          <select className="input" value={ctxKind} onChange={(e) => setCtxKind(e.target.value as GlossContext['kind'])}>
            <option value="tarina">tarina (yleinen)</option>
            <option value="koodi">koodi</option>
            <option value="polku">polku</option>
          </select>
        </label>
      </div>
      {ctxKind === 'koodi' && (
        <label className="field">
          <span>KOODI (NUMEROJONO)</span>
          <input className="input mono" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="esim. 629" />
        </label>
      )}
      {ctxKind === 'polku' && (
        <label className="field">
          <span>POLKU</span>
          <select className="input" value={pathId} onChange={(e) => setPathId(e.target.value)}>
            {story.paths.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.theme}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>MERKITYKSET (PILKULLA EROTETTUNA)</span>
        <input className="input" value={meanings} onChange={(e) => setMeanings(e.target.value)} />
      </label>
      <div className="mx-form-grid">
        <label className="field">
          <span>HENKILÖ (VALINNAINEN)</span>
          <PersonSelect
            story={story}
            value={personId}
            allowNone="— ei henkilöä —"
            onChange={(v) => {
              setPersonId(v);
              const p = story.persons.find((x) => x.id === v);
              if (p) setName(p.name);
            }}
          />
        </label>
        <label className="field">
          <span>NIMI (VALINNAINEN)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="characters" />
        </label>
      </div>
      <label className="field">
        <span>HUOMIO</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <FormButtons onCancel={onDone} disabled={!ctx || !symbol.trim()} />
    </form>
  );
}

// ------------------------------------------------------------------ polut

function PathsSection({ story }: { story: StoryModel }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <details className="mx-story-sec">
      <summary>Polut ({story.paths.length})</summary>
      <div className="mx-small faint">
        Askeleen symboli on käyttäjän antama numero tässä polussa (esim. HANNA = 2), ei samannimisten järjestysnumero.
        Määrittelyjärjestys on suunta 234; 432 lukee polun takaperin.
      </div>
      {err && <div className="note err">{err}</div>}
      {story.paths.map((p) =>
        editing === p.id ? (
          <PathForm key={p.id} story={story} initial={p} onDone={() => setEditing(null)} />
        ) : (
          <div key={p.id} className="mx-item">
            <div className="mx-item-head">
              <b>{p.title}</b>
              <span className="mx-small">· {p.theme || '–'}</span>
            </div>
            <div className="mx-sym-strip compact">
              {p.steps.map((s, i) => (
                <span key={i} className="mx-sym-item">
                  {i > 0 && <span className="mx-sym-arrow">→</span>}
                  <span className="mx-sym-chip">
                    <span className="mx-sym-num">{s.symbol || '?'}</span>
                    {s.personId ? personLabel(story, s.personId) : normName(s.name)}
                  </span>
                </span>
              ))}
            </div>
            <div className="mx-small faint">
              {HYPOTHESIS_LABELS[p.hypothesis.timing]} · lähde: {p.source} · <span className="mono">{p.id}</span>
            </div>
            <RowButtons
              open={{ kind: 'path', pathId: p.id }}
              onEdit={() => {
                setErr(null);
                setEditing(p.id);
              }}
              confirming={confirm === p.id}
              setConfirming={(b) => setConfirm(b ? p.id : null)}
              onDelete={() => {
                setErr(deletePath(p.id));
                setConfirm(null);
              }}
            />
          </div>
        ),
      )}
      {editing === 'new' ? (
        <PathForm story={story} initial={null} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="mx-btn" onClick={() => setEditing('new')}>
          + Lisää polku
        </button>
      )}
    </details>
  );
}

function PathForm({ story, initial, onDone }: { story: StoryModel; initial: StoryPath | null; onDone: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [theme, setTheme] = useState(initial?.theme ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [steps, setSteps] = useState<PathStep[]>(initial?.steps.map((s) => ({ ...s })) ?? [{ name: '', personId: null, symbol: '', stage: '' }]);
  const patch = (i: number, p: Partial<PathStep>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  };
  const ok = title.trim() && steps.length > 0 && steps.every((s) => normName(s.name) && s.symbol.trim());
  return (
    <form
      className="mx-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        const nextSteps = steps.map((s) => ({ ...s, name: normName(s.name), symbol: s.symbol.trim(), stage: s.stage.trim() }));
        savePath({
          id: initial?.id ?? newId('polku'),
          title: title.trim(),
          theme: theme.trim(),
          steps: nextSteps,
          note: note.trim(),
          // Askelten muokkaus: lähde 'käyttäjä' ja ajoitus 'löydön-jälkeen' ("muokattu"); muuten ennallaan.
          ...editedPathMeta(initial, nextSteps, nowIso()),
          createdAt: initial?.createdAt ?? nowIso(),
        });
        onDone();
      }}
    >
      <div className="mx-form-grid">
        <label className="field">
          <span>OTSIKKO</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="esim. Polku C" />
        </label>
        <label className="field">
          <span>TEEMA</span>
          <input className="input" value={theme} onChange={(e) => setTheme(e.target.value)} />
        </label>
      </div>
      <div className="eyebrow">Askeleet järjestyksessä (234)</div>
      {steps.map((s, i) => (
        <div key={i} className="mx-step">
          <div className="mx-step-head">
            <span className="mx-step-no">{i + 1}.</span>
            <button type="button" className="mx-icon-btn" aria-label="Siirrä ylös" onClick={() => move(i, -1)} disabled={i === 0}>
              ↑
            </button>
            <button type="button" className="mx-icon-btn" aria-label="Siirrä alas" onClick={() => move(i, 1)} disabled={i === steps.length - 1}>
              ↓
            </button>
            <button type="button" className="mx-icon-btn danger" aria-label="Poista askel" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
          <div className="mx-form-grid">
            <label className="field">
              <span>NIMI</span>
              <input className="input" value={s.name} onChange={(e) => patch(i, { name: e.target.value })} autoCapitalize="characters" />
            </label>
            <label className="field">
              <span>HENKILÖ</span>
              <PersonSelect
                story={story}
                value={s.personId ?? ''}
                allowNone="— vain nimi —"
                onChange={(v) => {
                  const p = story.persons.find((x) => x.id === v);
                  patch(i, { personId: v || null, ...(p ? { name: p.name } : {}) });
                }}
              />
            </label>
            <label className="field">
              <span>SYMBOLI</span>
              <input className="input mono" value={s.symbol} onChange={(e) => patch(i, { symbol: e.target.value })} placeholder="esim. 2" />
            </label>
            <label className="field">
              <span>VAIHE</span>
              <input className="input" value={s.stage} onChange={(e) => patch(i, { stage: e.target.value })} placeholder="esim. siirtymä" />
            </label>
          </div>
        </div>
      ))}
      <button type="button" className="mx-btn" onClick={() => setSteps([...steps, { name: '', personId: null, symbol: '', stage: '' }])}>
        + Lisää askel
      </button>
      <label className="field">
        <span>HUOMIO</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <FormButtons onCancel={onDone} disabled={!ok} />
    </form>
  );
}

// ------------------------------------------------------------------ vienti, tuonti ja siemendata

function StoryTools({ story }: { story: StoryModel }) {
  const [preview, setPreview] = useState('');
  const [importText, setImportText] = useState('');
  const [pending, setPending] = useState<{ story: StoryModel; dropped: string[]; errors: string[]; source: string } | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Tuodun polun ”ennen löydöstä” hyväksytään vain tämän laitteen lukitusta vasten (muuten 'ei-tiedossa' + varoitus).
  const locks = useApp((s) => s.matrix.locks);
  // Tapahtumat, joiden henkilölinkit jäisivät osoittamaan olemattomiin henkilöihin: listataan vahvistuksessa.
  const events = useApp((s) => s.events);
  const pendingDangling = useMemo(() => (pending ? danglingEventPersons(events, pending.story) : []), [pending, events]);
  const resetDangling = useMemo(() => (confirmReset ? danglingEventPersons(events, createSeedStory()) : []), [confirmReset, events]);
  const json = () => JSON.stringify(story, null, 2);
  const check = (text: string, source: string) => {
    setPending(null);
    setImportErr(null);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      setImportErr(`JSON ei kelpaa: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const r = sanitizeStory(raw, locks);
    if (!r.story) {
      setImportErr(`Tiedosto ei ole tarinamalli: ${r.dropped.join(' ')}`);
      return;
    }
    setPending({ story: r.story, dropped: r.dropped, errors: validateStory(r.story), source });
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <details className="mx-story-sec" open>
      <summary>Vienti, tuonti ja siemendata</summary>
      <div className="mx-btn-row">
        <button type="button" className="mx-btn" data-testid="matrix-story-export" onClick={() => copyText(json(), 'Tarina (JSON)', setPreview)}>
          Vie JSON
        </button>
        {!IS_ARTIFACT && (
          <button type="button" className="mx-btn ghost" onClick={() => downloadText(json(), `pi-atlas-tarina-${stamp}.json`, 'application/json')}>
            Lataa JSON
          </button>
        )}
        <button type="button" className="mx-btn ghost" onClick={() => setPreview(preview ? '' : json())}>
          {preview ? 'Piilota JSON' : 'Näytä JSON'}
        </button>
      </div>
      {preview && <textarea className="input mono mx-json" readOnly value={preview} onFocus={(e) => e.target.select()} />}

      <div className="eyebrow">Tuo JSON</div>
      <textarea
        className="input mono mx-json"
        id="mx-story-import"
        value={importText}
        placeholder="Liitä tarinamallin JSON tähän"
        onChange={(e) => setImportText(e.target.value)}
      />
      <div className="mx-btn-row">
        <button type="button" className="mx-btn" data-testid="matrix-story-import" disabled={!importText.trim()} onClick={() => check(importText, 'liitetty teksti')}>
          Tuo JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) check(await f.text(), f.name);
            e.target.value = '';
          }}
        />
        <button type="button" className="mx-btn ghost" onClick={() => fileRef.current?.click()}>
          Valitse tiedosto…
        </button>
      </div>
      {importErr && <div className="note err">{importErr}</div>}
      {pending && (
        <div className="card flat section" style={{ gap: 8 }}>
          <div className="mx-small">
            Tuotava tarina ({pending.source}): {pending.story.persons.length} henkilöä, {pending.story.paths.length} polkua,{' '}
            {pending.story.glosses.length} tulkintaa, {pending.story.relations.length} suhdetta.
          </div>
          {pending.dropped.map((d) => (
            <div key={d} className="note warn">
              {d}
            </div>
          ))}
          {pending.errors.length > 0 && (
            <div className="note err">
              Eheystarkistus (validateStory): {pending.errors.length} virhettä. Virheet näytetään myös tuonnin jälkeen.
              <ul className="mx-errlist">
                {pending.errors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <DanglingNote list={pendingDangling} story={story} />
          <div className="mx-small">Tuonti korvaa nykyisen tarinan tällä laitteella. Vie nykyinen tarina ensin, jos haluat säilyttää sen.</div>
          <div className="mx-btn-row">
            <button
              type="button"
              className="mx-btn danger"
              data-testid="matrix-story-import-confirm"
              onClick={() => {
                importStory(pending.story, pending.source, pending.dropped);
                setPending(null);
                setImportText('');
              }}
            >
              Korvaa nykyinen tarina
            </button>
            <button type="button" className="mx-btn ghost" onClick={() => setPending(null)}>
              Peru
            </button>
          </div>
        </div>
      )}

      <div className="eyebrow">Testitapauksen siemendata</div>
      <div className="mx-small faint">Muokattua tarinaa ei koskaan korvata siemenellä automaattisesti. Palautus korvaa nykyisen tarinan.</div>
      {confirmReset && <DanglingNote list={resetDangling} story={story} />}
      {confirmReset ? (
        <div className="mx-btn-row">
          <span className="mx-small">Korvataanko nykyinen tarina siemendatalla?</span>
          <button
            type="button"
            className="mx-btn danger"
            data-testid="matrix-story-reset-confirm"
            onClick={() => {
              resetStoryToSeed();
              setConfirmReset(false);
            }}
          >
            Palauta
          </button>
          <button type="button" className="mx-btn ghost" onClick={() => setConfirmReset(false)}>
            Peru
          </button>
        </div>
      ) : (
        <button type="button" className="mx-btn" data-testid="matrix-story-reset" onClick={() => setConfirmReset(true)}>
          Palauta testitapauksen siemendata
        </button>
      )}
    </details>
  );
}

/** Vahvistuksen lista: tapahtumat, joiden henkilölinkit poistetaan, koska henkilöitä ei ole uudessa tarinassa. */
function DanglingNote({ list, story }: { list: { eventId: string; title: string; personIds: string[] }[]; story: StoryModel }) {
  if (!list.length) return null;
  return (
    <div className="note warn" data-testid="matrix-story-dangling">
      Tapahtumien henkilölinkit ({list.length} {list.length === 1 ? 'tapahtuma' : 'tapahtumaa'}) viittaavat henkilöihin, joita uudessa
      tarinassa ei ole. Vahvistus poistaa nämä linkit tapahtumista, ja poisto kirjataan muutoshistoriaan:
      <ul className="mx-errlist">
        {list.map((d) => (
          <li key={d.eventId}>
            ”{d.title}”: {d.personIds.map((id) => personLinkLabel(story, id)).join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
