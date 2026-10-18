// Etsi reitti -sivu (Path Discovery, docs/POLKUHAKU.md): lähtö- ja tavoitetila, tunnisteet, tunnetut välisolmut,
// aikarajaus, parametrit (lukitaan SHA-256:lla ennen ajoa), haku 432 / 234 / kaksisuuntainen / 369, tulos,
// tallennetut tulokset ja ajohistoria monivertailuineen. Tekstit ovat käyttäjän symbolista tulkintaa: haku käyttää
// vain hyväksyttyjen tunnisteiden koodeja.
import { useEffect, useMemo, useState } from 'react';
import type { DateFormat } from '../../core/encodings';
import { personLabel } from '../../core/matrix/story';
import { isoDatePart } from '../../core/path/blind';
import { canonicalQuery } from '../../core/path/canonical';
import { encodeIdentifier, sameIdentifierSets, sameSetsWarning } from '../../core/path/identifiers';
import { PATH_RULES, RULE_ORDER } from '../../core/path/rules';
import { fmtCost } from '../../core/path/score';
import { validatePathParams } from '../../core/path/search';
import type { IdentifierKind, IdentifierRole, PathIdentifier, PathParams, PathRuleId, SearchMode } from '../../core/path/types';
import { PATH_VERSION } from '../../core/path/types';
import {
  DATE_FORMATS,
  EXPLORATORY_LABEL,
  exploreVerdict,
  IDENTIFIER_KINDS,
  identifiersOfRole,
  isoShortPath,
  makeIdentifier,
  pathBH,
  pathConfigKey,
  pathQueryKey,
  pathQueryOf,
  pathTestsTotal,
  PathRunSummary,
} from '../../state/path';
import {
  addPathIdentifier,
  addStoryNamesAsKnown,
  deletePathResult,
  extractPathIdentifiers,
  openPathResult,
  removePathIdentifier,
  resetPathParams,
  runPathSearch,
  setPathForm,
  setPathParams,
  setPathTimeRange,
} from '../../state/path-actions';
import { useApp } from '../../state/store';
import { fmtDateTime, fmtN, fmtPfi } from '../format';
import { JobProgress, PathMultipleComparisonNote, ROLE_SLUG, useSha256 } from './path-bits';
import { PathResultView } from './PathResult';

const KIND_TITLE: Record<IdentifierKind, string> = {
  nimi: 'nimi',
  sana: 'sana',
  numerojono: 'numerojono',
  päivämäärä: 'päivämäärä',
  henkilö: 'henkilö',
  tapahtuma: 'tapahtuma',
};

export function PathPage() {
  return (
    <section className="section pd-page" data-testid="path-page" aria-label="Etsi reitti">
      <div className="section" style={{ gap: 6 }}>
        <h2 className="h2">Etsi reitti</h2>
        <div className="mx-small muted">
          Haku etsii piin desimaaleista laskettavia reittejä lähtötilan ja tavoitetilan tunnisteiden välille ({PATH_VERSION}). Pelkkä reitin
          löytyminen ei ole näyttöä: jos pii sisältää kaikki numerosarjat, se sisältää yhtä lailla väärät tarinat. Vain sokkotesti voi tukea
          väitettä, että menetelmä tunnistaa todellisia tapahtumia.
        </div>
      </div>
      <PathFormCard />
      <ParamsPanel />
      <RunActions />
      <PathResultView />
      <SavedResults />
      <RunHistory />
    </section>
  );
}

// ------------------------------------------------------------------ lomake ja tunnisteet

function PathFormCard() {
  const form = useApp((s) => s.matrix.path.form);
  const [addOpen, setAddOpen] = useState<IdentifierRole | null>(null);
  const starts = identifiersOfRole(form.identifiers, 'lähtö');
  const goals = identifiersOfRole(form.identifiers, 'tavoite');
  const same = sameIdentifierSets(starts, goals);
  const sameLabels = [...new Set(starts.map((i) => i.label))];
  const common = { addOpen, setAddOpen };
  return (
    <div className="card section pd-form" style={{ gap: 14 }}>
      <IdentifierBlock role="lähtö" text={form.startText} {...common} />
      <IdentifierBlock role="tavoite" text={form.goalText} {...common} />
      {same && (
        <div className="note warn" data-testid="path-same-warning">
          {sameSetsWarning(sameLabels)}
        </div>
      )}
      <IdentifierBlock role="tunnettu" text="" {...common} />
      <TimeRange />
    </div>
  );
}

function IdentifierBlock({
  role,
  text,
  addOpen,
  setAddOpen,
}: {
  role: IdentifierRole;
  text: string;
  addOpen: IdentifierRole | null;
  setAddOpen: (r: IdentifierRole | null) => void;
}) {
  const ids = useApp((s) => s.matrix.path.form.identifiers);
  const mine = identifiersOfRole(ids, role);
  const slug = ROLE_SLUG[role];
  const open = addOpen === role;
  return (
    <div className={`pd-block r-${slug}`} data-testid={`path-block-${slug}`}>
      {role === 'tunnettu' ? (
        <>
          <div className="eyebrow">Tunnetut välisolmut (sanasto)</div>
          <div className="mx-small faint">
            Tunnetut henkilöt, tapahtumat ja numerosarjat ovat sallittuja välisolmuja. Vain sanaston koodien todennetut osumat ovat
            solmuja; tarinan suhteet eivät ole särmiä.
          </div>
        </>
      ) : (
        <label className="field">
          <span>{role === 'lähtö' ? 'LÄHTÖTILA' : 'TAVOITETILA'} (oma kuvaus, symbolinen)</span>
          <textarea
            className="input"
            id={role === 'lähtö' ? 'path-start' : 'path-goal'}
            value={text}
            placeholder={role === 'lähtö' ? 'esim. Hanna muuttaa pois' : 'esim. Ida löytää uuden kodin'}
            onChange={(e) => setPathForm(role === 'lähtö' ? { startText: e.target.value } : { goalText: e.target.value })}
          />
        </label>
      )}
      <div className="pd-chips" data-testid={`path-chips-${slug}`}>
        {mine.map((i) => (
          <IdentifierChip key={i.id} id={i} />
        ))}
        {!mine.length && (
          <span className="mx-small faint">
            {role === 'tunnettu' ? 'Ei tunnettuja välisolmuja.' : `Ei ${role === 'lähtö' ? 'lähtö' : 'tavoite'}tunnisteita.`}
          </span>
        )}
      </div>
      <div className="mx-btn-row">
        {role !== 'tunnettu' ? (
          <button
            type="button"
            className="mx-btn"
            data-testid={`path-extract-${slug}`}
            disabled={!text.trim()}
            onClick={() => extractPathIdentifiers(role)}
          >
            Poimi tunnetut nimet
          </button>
        ) : (
          <button type="button" className="mx-btn" data-testid="path-known-story" onClick={() => addStoryNamesAsKnown()}>
            Lisää tarinan nimet tunnetuiksi
          </button>
        )}
        <button
          type="button"
          className="mx-btn ghost"
          aria-expanded={open}
          data-testid={`path-add-toggle-${slug}`}
          onClick={() => setAddOpen(open ? null : role)}
        >
          {open ? 'Sulje lisäys' : 'Lisää tunniste'}
        </button>
      </div>
      {open && <AddIdentifierForm defaultRole={role} onDone={() => setAddOpen(null)} />}
    </div>
  );
}

function IdentifierChip({ id }: { id: PathIdentifier }) {
  const e = encodeIdentifier(id);
  const name = id.label || id.value || id.id;
  return (
    <div
      className={`pd-chip r-${ROLE_SLUG[id.role]}${e.ok ? '' : ' bad'}`}
      data-testid="path-chip"
      data-role={id.role}
      data-code={e.ok ? e.code : ''}
    >
      <div className="pd-chip-head">
        <b className="pd-chip-name">{name}</b>
        <span className="mx-chip">{KIND_TITLE[id.kind]}</span>
        {id.origin !== 'käyttäjä' && <span className="mx-chip">{id.origin}</span>}
        <button type="button" className="pd-chip-x" aria-label={`Poista tunniste ${name}`} data-testid="path-chip-remove" onClick={() => removePathIdentifier(id.id)}>
          ×
        </button>
      </div>
      {e.ok ? (
        <div className="pd-chip-code">
          <span className="mono pd-code">{e.code}</span> <span className="faint">{e.rule}</span>
        </div>
      ) : (
        <div className="pd-chip-err">{e.error}</div>
      )}
    </div>
  );
}

function AddIdentifierForm({ defaultRole, onDone }: { defaultRole: IdentifierRole; onDone: () => void }) {
  const story = useApp((s) => s.matrix.story);
  const events = useApp((s) => s.events);
  const [kind, setKind] = useState<IdentifierKind>('nimi');
  const [role, setRole] = useState<IdentifierRole>(defaultRole);
  const [value, setValue] = useState('');
  const [personId, setPersonId] = useState('');
  const [eventId, setEventId] = useState('');
  const [fmt, setFmt] = useState<DateFormat>('DDMMYYYY');
  const isDate = kind === 'päivämäärä' || kind === 'tapahtuma';

  const candidate: PathIdentifier | null = useMemo(() => {
    if (kind === 'henkilö') {
      const p = story.persons.find((x) => x.id === personId);
      return p ? makeIdentifier(role, 'henkilö', p.name, { personId: p.id, label: personLabel(story, p) }) : null;
    }
    if (kind === 'tapahtuma') {
      const ev = events.find((x) => x.id === eventId);
      if (!ev) return null;
      const iso = isoDatePart(ev.date) ?? '';
      return makeIdentifier(role, 'tapahtuma', iso, { eventId: ev.id, label: `${ev.title} ${iso || '(ei päivää)'}`.trim(), dateFormat: fmt, origin: 'tapahtumat' });
    }
    if (!value.trim()) return null;
    return makeIdentifier(role, kind, value, isDate ? { dateFormat: fmt } : {});
  }, [kind, role, value, personId, eventId, fmt, story, events, isDate]);
  const enc = candidate ? encodeIdentifier(candidate) : null;

  return (
    <form
      className="pd-add"
      data-testid="path-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!candidate) return;
        if (addPathIdentifier(candidate)) {
          setValue('');
          onDone();
        }
      }}
    >
      <div className="mx-form-grid">
        <label className="field">
          <span>TYYPPI</span>
          <select className="input" id="path-id-kind" value={kind} onChange={(e) => setKind(e.target.value as IdentifierKind)}>
            {IDENTIFIER_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_TITLE[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>ROOLI</span>
          <select className="input" id="path-id-role" value={role} onChange={(e) => setRole(e.target.value as IdentifierRole)}>
            <option value="lähtö">lähtö</option>
            <option value="tavoite">tavoite</option>
            <option value="tunnettu">tunnettu</option>
          </select>
        </label>
        {isDate && (
          <label className="field">
            <span>PÄIVÄMÄÄRÄN MUOTO</span>
            <select className="input" id="path-id-format" value={fmt} onChange={(e) => setFmt(e.target.value as DateFormat)}>
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {kind === 'henkilö' ? (
        <label className="field">
          <span>HENKILÖ TARINASTA</span>
          <select className="input" id="path-id-person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">valitse henkilö…</option>
            {story.persons.map((p) => (
              <option key={p.id} value={p.id}>
                {personLabel(story, p)}
              </option>
            ))}
          </select>
        </label>
      ) : kind === 'tapahtuma' ? (
        <label className="field">
          <span>TAPAHTUMA</span>
          <select className="input" id="path-id-event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">{events.length ? 'valitse tapahtuma…' : 'ei tapahtumia (lisää Tapahtumat-paneelissa)'}</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title} · {isoDatePart(ev.date) ?? 'ei päivämäärää'}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="field">
          <span>ARVO</span>
          <input
            className="input"
            id="path-id-value"
            type={kind === 'päivämäärä' ? 'date' : 'text'}
            inputMode={kind === 'numerojono' ? 'numeric' : undefined}
            placeholder={kind === 'numerojono' ? 'esim. 629' : kind === 'sana' ? 'esim. KOTI' : 'esim. HANNA'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
      )}
      <div className={`mx-small ${enc && !enc.ok ? 'mx-bad' : 'faint'}`} data-testid="path-id-preview">
        {enc ? (enc.ok ? `Koodi ${enc.code} · ${enc.rule}` : enc.error) : 'Anna arvo, niin koodi ja koodaussääntö näkyvät tässä.'}
      </div>
      <div className="mx-btn-row">
        <button type="submit" className="mx-btn primary" data-testid="path-id-add" disabled={!candidate}>
          Lisää tunniste
        </button>
        <button type="button" className="mx-btn ghost" onClick={onDone}>
          Peru
        </button>
      </div>
    </form>
  );
}

function TimeRange() {
  const tr = useApp((s) => s.matrix.path.form.timeRange);
  return (
    <div className="pd-block" data-testid="path-time-range">
      <div className="eyebrow">Aikarajaus (valinnainen)</div>
      <div className="mx-small faint">
        Rajaa vain tapahtumatunnisteita. Piin indekseillä ei ole kalenteriaikaa, joten rajaus ei vaikuta piin indekseihin.
      </div>
      <div className="mx-form-grid">
        <label className="field">
          <span>ALKAEN</span>
          <input className="input" type="date" id="path-from" value={tr?.from ?? ''} onChange={(e) => setPathTimeRange(e.target.value, tr?.to ?? null)} />
        </label>
        <label className="field">
          <span>PÄÄTTYEN</span>
          <input className="input" type="date" id="path-to" value={tr?.to ?? ''} onChange={(e) => setPathTimeRange(tr?.from ?? null, e.target.value)} />
        </label>
      </div>
      {tr && (
        <button type="button" className="mx-btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPathTimeRange(null, null)}>
          Poista aikarajaus
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ parametrit ja lukitus

const NUM_FIELDS: { key: Exclude<keyof PathParams, 'rules' | 'use369'>; label: string; help: string }[] = [
  { key: 'indexWindow', label: 'indexWindow (W)', help: 'indeksi-seuraava: suurin |Δn|; 369-mod9 käyttää 9·W' },
  { key: 'fibKMin', label: 'fibKMin', help: 'fib-naapuri: pienin k (F_k)' },
  { key: 'fibKMax', label: 'fibKMax', help: 'fib-naapuri: suurin k' },
  { key: 'nearestK', label: 'nearestK', help: 'oktaedri-lähin: lähimpien osumien määrä' },
  { key: 'chordMax', label: 'chordMax', help: 'oktaedri-lähin: suurin chord-etäisyys' },
  { key: 'minCodeLength', label: 'minCodeLength', help: 'lyhyempiä koodeja ei käytetä solmuina' },
  { key: 'maxHitsPerCode', label: 'maxHitsPerCode', help: 'koodi, jolla on enemmän osumia, hylätään' },
  { key: 'maxEdges', label: 'maxEdges', help: 'reitin enimmäispituus askelina' },
  { key: 'budget', label: 'budget', help: 'laajennuksia kummallekin puolelle' },
  { key: 'maxRoutes', label: 'maxRoutes', help: 'reittiehdokkaita enintään' },
];

/** Numerokenttä paikallisella tekstitilalla, jotta keskeneräinen syöte (esim. "0,") ei katoa. */
function NumField({ k, value, label, help }: { k: string; value: number; label: string; help: string }) {
  const [text, setText] = useState(String(value));
  // Ulkoinen muutos (esim. Palauta oletukset tai avattu tallennettu tulos): kenttä seuraa arvoa.
  useEffect(() => {
    const parsed = text.trim() === '' ? NaN : Number(text.replace(',', '.'));
    if (Number.isFinite(value) && parsed !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="field" title={help}>
      <span>{label}</span>
      <input
        className="input mono"
        id={`path-param-${k}`}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim() === '' ? NaN : Number(e.target.value.replace(',', '.'));
          setPathParams({ [k]: v } as Partial<PathParams>);
        }}
      />
    </label>
  );
}

function ParamsPanel() {
  const form = useApp((s) => s.matrix.path.form);
  const p = form.params;
  const errors = validatePathParams(p);
  const query = pathQueryOf(form);
  const canonical = errors.length ? null : canonicalQuery(query, p, form.mode);
  const hash = useSha256(canonical);
  const toggleRule = (id: PathRuleId) => setPathParams({ rules: p.rules.includes(id) ? p.rules.filter((r) => r !== id) : [...p.rules, id] });
  return (
    <details className="pd-params" data-testid="path-params">
      <summary>
        <span className="pd-params-title">Parametrit</span>
        <span className="mx-small faint mono">
          W {fmtN(p.indexWindow)} · F{p.fibKMin}–{p.fibKMax} · K {p.nearestK} · {p.maxEdges} askelta{p.use369 ? ' · 369' : ''}
          {hash ? ` · ${hash.slice(0, 8)}…` : ''}
        </span>
      </summary>
      <div className="pd-params-body">
        <div className="pd-rules" role="group" aria-label="Säännöt">
          {RULE_ORDER.filter((id) => !PATH_RULES[id].is369).map((id) => (
            <label key={id} className="check pd-check">
              <input type="checkbox" checked={p.rules.includes(id)} onChange={() => toggleRule(id)} data-testid={`path-rule-${id}`} />
              <span>
                {PATH_RULES[id].title} <span className="faint">· {PATH_RULES[id].layer}</span>
              </span>
            </label>
          ))}
          <label className="check pd-check">
            <input type="checkbox" checked={p.use369} onChange={(e) => setPathParams({ use369: e.target.checked })} data-testid="path-param-use369" />
            <span>
              use369: 369-säännöt (siirtymä, F₃ₖ, mod 9) <span className="faint">· jokainen askel on muunnos</span>
            </span>
          </label>
        </div>
        <div className="mx-form-grid">
          {NUM_FIELDS.map((f) => (
            <NumField key={f.key} k={f.key} value={p[f.key]} label={f.label} help={f.help} />
          ))}
        </div>
        {errors.length > 0 && (
          <ul className="pd-list bad" data-testid="path-param-errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="pd-lock" data-testid="path-hash">
          SHA-256 kanonisesta kyselystä (tila {form.mode}), lukitaan ajon alussa ennen tulosta:{' '}
          <span className="mono">{errors.length ? 'parametrit eivät kelpaa' : hash ?? 'lasketaan…'}</span>
        </div>
        <button type="button" className="mx-btn ghost" data-testid="path-params-reset" onClick={() => resetPathParams()}>
          Palauta oletukset
        </button>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ haku

function RunActions() {
  const form = useApp((s) => s.matrix.path.form);
  const running = useApp((s) => s.matrix.path.running);
  const routeRunning = useApp((s) => s.matrix.routeTest.running);
  const error = useApp((s) => s.matrix.path.error);
  const current = useApp((s) => s.matrix.path.current);
  const index = useApp((s) => s.matrix.path.index.searches);
  const errors = validatePathParams(form.params);
  const hasStart = form.identifiers.some((i) => i.role === 'lähtö');
  const hasGoal = form.identifiers.some((i) => i.role === 'tavoite');
  const busy = !!running || !!routeRunning;
  const can = !busy && !errors.length && hasStart && hasGoal;
  const query = pathQueryOf(form);
  const qk = pathQueryKey(query);
  const preview = exploreVerdict(index, qk, pathConfigKey(query, form.params));
  const preview369 = exploreVerdict(index, qk, pathConfigKey(query, { ...form.params, use369: true }));
  const missed = !!current && current.outcome.status !== 'löytyi';
  const run = (mode: SearchMode, use369 = false) => void runPathSearch(mode, { use369 });
  return (
    <section className="section pd-actions" aria-label="Haku" style={{ gap: 10 }}>
      <div className={`note ${preview.exploratory ? 'warn' : ''} mx-small`} data-testid="path-explore-preview">
        {preview.exploratory
          ? `Seuraava ajo näillä asetuksilla: ${preview.reason}`
          : 'Seuraava ajo: parametrit lukitaan ennen tulosta (SHA-256 kanonisesta kyselystä). Jos muutat parametreja tai tunnettuja välisolmuja tämän kyselyn tulosten näkemisen jälkeen, uusi ajo merkitään eksploratiiviseksi.'}
      </div>
      <div className="pd-run-grid">
        <button type="button" className="mx-btn" data-testid="path-run-432" disabled={!can} onClick={() => run('432')}>
          432 · etsi tavoitteesta taaksepäin
        </button>
        <button type="button" className="mx-btn" data-testid="path-run-234" disabled={!can} onClick={() => run('234')}>
          234 · etsi lähdöstä eteenpäin
        </button>
        <button type="button" className="mx-btn primary pd-run-both" data-testid="path-run-both" disabled={!can} onClick={() => run('kaksisuuntainen')}>
          Kaksisuuntainen haku
        </button>
      </div>
      <div className={`pd-369${missed ? ' hot' : ''}`} data-highlight={missed ? 'true' : 'false'}>
        <button type="button" className="pd-369-btn" data-testid="path-run-369" disabled={!can} onClick={() => run('kaksisuuntainen', true)}>
          <span className="pd-369-num">369</span> · tutki vaihtoehtoiset reitit
        </button>
        <div className="mx-small">
          Avausavain: ei lupaa ratkaisua eikä tuota tulkintaa. Sama kysely kaksisuuntaisena 369-säännöillä (siirtymä 3·6·9, F₃ₖ, mod 9);
          jokainen 369-askel on muunnos.
          {preview369.exploratory ? ` Ajo merkitään: ${EXPLORATORY_LABEL}.` : ''}
          {missed ? ' Edellinen haku ei löytänyt reittiä.' : ''}
        </div>
      </div>
      {!hasStart || !hasGoal ? (
        <div className="mx-small faint" data-testid="path-run-hint">
          Lisää vähintään yksi lähtö- ja yksi tavoitetunniste (esim. ”Poimi tunnetut nimet” tai ”Lisää tunniste”).
        </div>
      ) : errors.length ? (
        <div className="mx-small mx-bad">Korjaa parametrit ennen hakua.</div>
      ) : routeRunning && !running ? (
        <div className="mx-small faint">Reittitesti on käynnissä: odota sen valmistumista.</div>
      ) : null}
      <JobProgress kinds={['haku', 'sokkotesti']} testId="path-running" />
      {error && (
        <div className="note err" data-testid="path-error">
          {error}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ tallennetut tulokset

function SavedResults() {
  const saved = useApp((s) => s.matrix.path.saved);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <section className="section" data-testid="path-saved" aria-label="Tallennetut tulokset" style={{ gap: 8 }}>
      <div className="eyebrow">Tallennetut tulokset</div>
      {!saved.length && <div className="muted mx-small">Ei tallennettuja tuloksia. Aja haku ja paina ”Tallenna tulos”.</div>}
      {[...saved].reverse().map((r) => (
        <article key={r.id} className="card pd-saved" data-testid="path-saved-item">
          <div className="mx-saved-head">
            <b>{r.title}</b>
            <span className="mx-small faint">{fmtDateTime(r.createdAt)}</span>
          </div>
          <div className="mx-chips">
            <span className="mx-chip">{r.status}</span>
            <span className="mx-chip dir">{r.mode}</span>
            {r.params.use369 && <span className="mx-chip op">369</span>}
            <span className="mx-chip">{r.routes.length} reittiä</span>
            <span className="mx-chip mono">SHA-256 {r.hash.slice(0, 10)}…</span>
            {r.exploratory && <span className="mx-chip trail">eksploratiivinen</span>}
            <span className="mx-chip">
              Path Score {r.scores.map((s) => (s.total == null ? 'ei pistemäärää' : s.total)).join(', ') || '–'}
            </span>
            <span className={`mx-chip ${r.blindRef ? 'ok' : ''}`}>
              {r.blindRef ? `sokkotesti ${r.blindRef.hitsAt1}/${r.blindRef.folds} oikein` : 'ei testattu'}
            </span>
          </div>
          {r.routes[0] && (
            <div className="mx-small mono pd-saved-route">
              {r.routes[0].nodes.map((n) => `${n.labels.join('/') || n.code} ${n.code}@${fmtN(n.n)}`).join(' → ')} · {fmtCost(r.routes[0].cost)}
            </div>
          )}
          <div className="mx-btn-row">
            <button type="button" className="mx-btn" data-testid="path-saved-open" onClick={() => openPathResult(r.id)}>
              Avaa
            </button>
            {confirm === r.id ? (
              <>
                <button type="button" className="mx-btn danger" data-testid="path-saved-delete-confirm" onClick={() => deletePathResult(r.id)}>
                  Poista
                </button>
                <button type="button" className="mx-btn ghost" onClick={() => setConfirm(null)}>
                  Peru
                </button>
              </>
            ) : (
              <button type="button" className="mx-btn danger" data-testid="path-saved-delete" onClick={() => setConfirm(r.id)}>
                Poista
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------ ajohistoria

function resultText(r: PathRunSummary): string {
  if (r.status === 'käynnissä') return 'käynnissä…';
  if (r.status === 'keskeytetty' || r.status === 'virhe') return `${r.status}${r.error ? `: ${r.error}` : ''}`;
  if (r.kind === 'vertailu') return `p = ${r.pValue == null ? '–' : fmtPfi(r.pValue)}${r.reproducible === false ? ', ei toistettava' : ''}`;
  return r.status === 'löytyi' ? `${r.routes} reittiä · ${fmtCost(r.bestCost)}` : `ei reittiä (${r.reasons} syytä)`;
}

function RunHistory() {
  const runs = useApp((s) => s.matrix.path.runs);
  const counts = useApp((s) => s.matrix.path.counts);
  const blindRuns = useApp((s) => s.matrix.path.blindRuns);
  const m = pathTestsTotal(counts);
  const q = useMemo(() => {
    const ps = [
      ...runs.filter((r) => r.kind === 'vertailu' && r.pValue != null).map((r) => ({ id: r.id, p: r.pValue as number })),
      ...blindRuns.filter((r) => r.summary).map((r) => ({ id: r.id, p: r.summary!.pVsRandom })),
    ];
    const qs = pathBH(ps.map((x) => x.p), m);
    return new Map(ps.map((x, i) => [x.id, qs[i]]));
  }, [runs, blindRuns, m]);
  return (
    <section className="section" data-testid="path-history" aria-label="Ajohistoria" style={{ gap: 8 }}>
      <div className="eyebrow">Ajohistoria ja monivertailu</div>
      <PathMultipleComparisonNote testId="path-mc-note" />
      {!runs.length ? (
        <div className="muted mx-small">Ei vielä ajoja. Jokainen haku ja satunnaisvertailu kirjataan tiivisteineen.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Aika</th>
                <th>Laji</th>
                <th>Kysely</th>
                <th>Tila</th>
                <th>Tulos</th>
                <th className="r">q (BH)</th>
                <th>SHA-256</th>
                <th>Lukitus</th>
              </tr>
            </thead>
            <tbody>
              {[...runs].reverse().map((r) => (
                <tr key={r.id} data-testid="path-history-row" className={r.exploratory ? 'pd-row-exp' : ''}>
                  <td className="mono" title={isoShortPath(r.ts)}>
                    {fmtDateTime(r.ts)}
                  </td>
                  <td>{r.kind === 'haku' ? 'haku' : 'vertailu'}</td>
                  <td>{r.label}</td>
                  <td>
                    {r.mode}
                    {r.use369 ? ' · 369' : ''}
                    {r.nullSpec ? ` · R ${r.nullSpec.R}, S ${r.nullSpec.S}` : ''}
                  </td>
                  <td>{resultText(r)}</td>
                  <td className="r mono">{q.has(r.id) ? fmtPfi(q.get(r.id)!) : '–'}</td>
                  <td className="mono">{r.hash.slice(0, 10)}…</td>
                  <td title={r.exploratoryReason ?? ''}>{r.exploratory ? 'eksploratiivinen' : 'ennen tuloksia'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
