// Sokkotesti-sivu (Blind Discovery, PIATLAS-BLIND-1.0.0, docs/POLKUHAKU.md §7). Vain sokkotestin tulos voi tukea
// väitettä, että menetelmä tunnistaa todellisia tapahtumia. Parametrit (tyyppi, harhauttimet, siemen, jonot ja polkuhaun
// parametrit) lukitaan SHA-256:lla ennen ajoa, ja kaikki ajot tallennetaan, myös epäonnistuneet ja keskeytetyt.
import { useMemo } from 'react';
import { BLIND_DEFINITION, canonicalBlind } from '../../core/path/blind';
import { canonicalParams, stableStringify } from '../../core/path/canonical';
import type { BlindItemKind, BlindParams } from '../../core/path/types';
import { BLIND_VERSION, DEFAULT_PATH_PARAMS } from '../../core/path/types';
import { seedFrom } from '../../core/random';
import { setMatrixSub } from '../../state/matrix-actions';
import {
  BLIND_S_OPTIONS,
  blindConfigKey,
  blindItemsFor,
  blindItemStats,
  blindQueryKey,
  BlindRunRecord,
  DATE_FORMATS,
  EXPLORATORY_LABEL,
  exploreVerdict,
  pathBH,
  pathTestsTotal,
} from '../../state/path';
import { runBlindTest, selectBlindRun, setBlindForm } from '../../state/path-actions';
import { useApp } from '../../state/store';
import { fiNum, fmtDateTime, fmtN, fmtPfi } from '../format';
import { fmtFi, JobProgress, PathMultipleComparisonNote, useSha256 } from './path-bits';

const KIND_TITLE: Record<BlindItemKind, string> = {
  'polun-askel': 'polun askeleet',
  tapahtuma: 'tapahtumat',
};
const KIND_LONG: Record<BlindItemKind, string> = {
  'polun-askel': 'tarinan polkujen askeleet, koodi = nimen T9',
  tapahtuma: 'tapahtumat päivämäärineen, koodi = päivämäärä valitussa muodossa',
};

export function BlindPage() {
  return (
    <section className="section pd-page" data-testid="blind-page" aria-label="Sokkotesti">
      <div className="section" style={{ gap: 6 }}>
        <h2 className="h2">Sokkotesti</h2>
        <div className="mx-small muted" data-testid="blind-intro">
          Sokkotesti mittaa, tunnistaako menetelmä piilotetun todellisen tiedon. Jokainen kohde piilotetaan vuorollaan, ja sama
          kaksisuuntainen haku järjestää oikean vastauksen ja D samanpituista harhautinta saman ryhmän muiden kohteiden perusteella.
          Tulosta verrataan satunnaiseen valintaan ja samaan algoritmiin ilman piin numeroita (siemenelliset satunnaisjonot).
        </div>
      </div>
      <BlindForm />
      <BlindResultView />
      <BlindHistory />
    </section>
  );
}

function BlindForm() {
  const bf = useApp((s) => s.matrix.path.blindForm);
  const pathParams = useApp((s) => s.matrix.path.form.params);
  const story = useApp((s) => s.matrix.story);
  const events = useApp((s) => s.events);
  const running = useApp((s) => s.matrix.path.running);
  const routeRunning = useApp((s) => s.matrix.routeTest.running);
  const error = useApp((s) => s.matrix.path.blindError);
  const index = useApp((s) => s.matrix.path.index.blinds);
  const seed = seedFrom(bf.seedText);
  const params: BlindParams = useMemo(
    () => ({ kind: bf.kind, decoys: bf.decoys, seed, randomStrings: bf.randomStrings, dateFormat: bf.dateFormat, path: pathParams }),
    [bf, seed, pathParams],
  );
  const ctx = useMemo(
    () => ({ story, events: events.map((e) => ({ id: e.id, title: e.title, date: e.date, personIds: e.personIds ?? [] })) }),
    [story, events],
  );
  const stats = useMemo(() => blindItemStats(bf.kind, story, events, params, ctx), [bf.kind, story, events, params, ctx]);
  const items = useMemo(() => blindItemsFor(bf.kind, story, events, bf.dateFormat), [bf.kind, story, events, bf.dateFormat]);
  const canonical = useMemo(() => (items.length ? canonicalBlind(items, params) : null), [items, params]);
  const hash = useSha256(canonical);
  const preview = exploreVerdict(index, blindQueryKey(items, bf.kind, bf.dateFormat), blindConfigKey(params), 'Sama kohdejoukko');
  const customParams = stableStringify(canonicalParams(pathParams)) !== stableStringify(canonicalParams(DEFAULT_PATH_PARAMS));
  const decoysOk = Number.isInteger(bf.decoys) && bf.decoys >= 1;
  const can = !running && !routeRunning && stats.usable > 0 && decoysOk;
  return (
    <div className="card section pd-form" style={{ gap: 12 }} data-testid="blind-form">
      <div className="mx-form-grid">
        <label className="field pd-span-all">
          <span>KOHTEET</span>
          <select className="input" id="blind-kind" value={bf.kind} onChange={(e) => setBlindForm({ kind: e.target.value as BlindItemKind })}>
            <option value="polun-askel">{KIND_TITLE['polun-askel']}</option>
            <option value="tapahtuma">{KIND_TITLE.tapahtuma}</option>
          </select>
        </label>
        <label className="field">
          <span>HARHAUTTIMET D</span>
          <input
            className="input mono"
            id="blind-decoys"
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={Number.isFinite(bf.decoys) ? bf.decoys : ''}
            onChange={(e) => setBlindForm({ decoys: e.target.value === '' ? NaN : Math.floor(Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>SIEMEN</span>
          <input className="input mono" id="blind-seed" value={bf.seedText} onChange={(e) => setBlindForm({ seedText: e.target.value })} />
        </label>
        <label className="field">
          <span>SATUNNAISJONOT</span>
          <select className="input" id="blind-strings" value={bf.randomStrings} onChange={(e) => setBlindForm({ randomStrings: Number(e.target.value) })}>
            {BLIND_S_OPTIONS.map((x) => (
              <option key={x} value={x}>
                {x} jonoa
              </option>
            ))}
          </select>
        </label>
        {bf.kind === 'tapahtuma' && (
          <label className="field">
            <span>PÄIVÄMÄÄRÄN MUOTO</span>
            <select className="input" id="blind-date-format" value={bf.dateFormat} onChange={(e) => setBlindForm({ dateFormat: e.target.value as BlindParams['dateFormat'] })}>
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="mx-small faint">
        Siemen ”{bf.seedText}” = {seed}. {!decoysOk && <span className="mx-bad">Harhauttimia on oltava vähintään 1.</span>}
      </div>

      <div className="pd-block" data-testid="blind-items">
        <div className="eyebrow">Kohteet</div>
        <div className="mx-small">
          <b>
            Käyttökelpoisia kohteita {stats.usable} / {stats.total}
          </b>{' '}
          ({KIND_LONG[bf.kind]}).{' '}
          {bf.kind === 'polun-askel'
            ? 'Jokainen polun askel piilotetaan vuorollaan; konteksti = saman polun muut askeleet.'
            : 'Tapahtuman koodi on sen päivämäärä valitussa muodossa; konteksti = muut tapahtumat.'}
        </div>
        {stats.usable === 0 && (
          <div className="note warn mx-small">
            {bf.kind === 'tapahtuma'
              ? 'Käyttökelpoisia tapahtumia ei ole. Tarvitaan vähintään kaksi tapahtumaa kelvollisella päivämäärällä (VVVV-KK-PP), koska piilotetulla kohteella on oltava kontekstia.'
              : 'Käyttökelpoisia polun askeleita ei ole. Lisää tarinaan polku, jossa on vähintään kaksi koodattavaa askelta.'}
          </div>
        )}
        {stats.skipped.length > 0 && (
          <details className="pd-details" open={stats.skipped.length <= 4}>
            <summary>Ohitetaan {stats.skipped.length} kohdetta (syyt)</summary>
            <ul className="pd-list">
              {stats.skipped.map((s, i) => (
                <li key={i}>
                  <b>{s.label || '–'}</b>: {s.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {stats.notes.map((n, i) => (
          <div key={i} className="note warn mx-small">
            {n}
          </div>
        ))}
      </div>

      <div className="pd-block" data-testid="blind-path-params">
        <div className="eyebrow">Polkuhaun parametrit (vain luku)</div>
        <div className="mx-small mono">
          säännöt {pathParams.rules.join(', ') || '–'}
          {pathParams.use369 ? ' + 369' : ''} · W {fmtN(pathParams.indexWindow)} · F{pathParams.fibKMin}–{pathParams.fibKMax} · K{' '}
          {pathParams.nearestK} · chord ≤ {String(pathParams.chordMax).replace('.', ',')} · minCodeLength {pathParams.minCodeLength} ·
          maxHits {fmtN(pathParams.maxHitsPerCode)} · maxEdges {pathParams.maxEdges} · budget {fmtN(pathParams.budget)} · maxRoutes{' '}
          {pathParams.maxRoutes}
        </div>
        <div className="mx-small faint">
          Samat parametrit kuin Etsi reitti -sivun lomakkeessa; haku on aina kaksisuuntainen.{' '}
          <button type="button" className="mx-link" onClick={() => setMatrixSub('reitinhaku')}>
            Muuta Etsi reitti -sivulla
          </button>
        </div>
        {customParams && (
          <div className="note warn mx-small">
            Parametreja on muutettu oletuksista. Jos ne valittiin hakutulosten perusteella, sokkotesti ei ole niiden osalta riippumaton.
          </div>
        )}
        <div className="pd-lock" data-testid="blind-hash">
          SHA-256 (canonicalBlind: parametrit ja kohteiden koodit), lukitaan ennen ajoa:{' '}
          <span className="mono">{canonical ? hash ?? 'lasketaan…' : 'ei kohteita'}</span>
        </div>
      </div>

      <div className={`note mx-small ${preview.exploratory ? 'warn' : ''}`} data-testid="blind-explore-preview">
        {preview.exploratory
          ? preview.reason
          : 'Asetukset lukitaan ennen ajoa. Jos muutat siementä, harhauttimia tai parametreja saman kohdejoukon tuloksen näkemisen jälkeen, uusi ajo on eksploratiivinen.'}
      </div>
      <button type="button" className="btn primary" data-testid="blind-run" disabled={!can} onClick={() => void runBlindTest()}>
        {running?.kind === 'sokkotesti' ? 'Sokkotesti käynnissä…' : 'Lukitse ja aja sokkotesti'}
      </button>
      {running && running.kind !== 'sokkotesti' && <div className="mx-small faint">Toinen työ on käynnissä ({running.label}).</div>}
      {routeRunning && <div className="mx-small faint">Reittitesti on käynnissä: odota sen valmistumista.</div>}
      <JobProgress kinds={['sokkotesti']} testId="blind-running" />
      {error && (
        <div className="note err" data-testid="blind-error">
          {error}
        </div>
      )}
    </div>
  );
}

function BlindResultView() {
  const runs = useApp((s) => s.matrix.path.blindRuns);
  const selected = useApp((s) => s.matrix.path.selectedBlind);
  const run = runs.find((r) => r.id === selected) ?? runs[runs.length - 1] ?? null;
  if (!run) return <div className="muted mx-small">Ei vielä sokkotestejä. Jokainen ajo kirjataan monivertailua varten.</div>;
  return <BlindResult run={run} />;
}

function verdictClass(r: BlindRunRecord): string {
  if (!r.summary) return 'user';
  return /^Sattumaa parempi/.test(r.summary.verdict) ? 'stat' : 'coded';
}

function BlindResult({ run }: { run: BlindRunRecord }) {
  const sm = run.summary;
  return (
    <section className="card section pd-result" data-testid="blind-result" aria-label="Sokkotestin tulos" style={{ gap: 12 }}>
      <div className="pd-result-head">
        <span className={`pill ${verdictClass(run)}`}>
          {run.status === 'valmis' ? (sm && /^Sattumaa parempi/.test(sm.verdict) ? 'Sattumaa parempi' : 'Ei näyttöä') : run.status}
        </span>
        <span className="pill">{run.params.kind}</span>
        <span className={`pill ${run.exploratory ? 'exp' : ''}`} data-testid="blind-exploratory">
          {run.exploratory ? EXPLORATORY_LABEL : 'asetukset lukittu ennen tulosta'}
        </span>
      </div>
      {run.status !== 'valmis' && (
        <div className="note err mx-small">
          Ajo {run.status === 'käynnissä' ? 'on käynnissä' : run.status}
          {run.error ? `: ${run.error}` : ''}. Ajo on kirjattu ja lasketaan monivertailuun.
        </div>
      )}
      {sm && (
        <div className="pd-verdict" data-testid="blind-verdict">
          {fiNum(sm.verdict)}
        </div>
      )}
      {/* Kierrokset heti johtopäätöksen jälkeen; oikein/väärin toisena sarakkeena, jotta se näkyy kapeallakin näytöllä. */}
      {run.folds.length > 0 && (
        <div className="table-wrap" data-testid="blind-folds">
          <table className="data">
            <thead>
              <tr>
                <th>Piilotettu</th>
                <th>Tulos</th>
                <th className="r">Sijoitus</th>
                <th>Konteksti</th>
                <th>Paras ehdokas</th>
                <th>Satunnaisjonot</th>
              </tr>
            </thead>
            <tbody>
              {run.folds.map((f, i) => (
                <tr key={i} data-testid="blind-fold" className={f.correct ? 'pd-row-ok' : ''}>
                  <td>
                    <b>{f.hiddenLabel}</b> <span className="faint">({f.group})</span>
                  </td>
                  <td className={f.correct ? 'mx-ok' : 'mx-bad'}>{f.correct ? '✓ oikein' : '✗ väärin'}</td>
                  <td className="r mono">
                    {f.rankPi} / {f.candidates}
                  </td>
                  <td>{f.contextLabels.join(', ')}</td>
                  <td>{f.topLabel}</td>
                  <td className="mono">{f.rankRandomStrings.length ? f.rankRandomStrings.join(', ') : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sm && (
        <dl className="kv pd-kv" data-testid="blind-summary">
          <dt>Kierroksia</dt>
          <dd>{sm.folds}</dd>
          <dt>Oikein ensimmäisenä</dt>
          <dd>
            {sm.hitsAt1} / {sm.folds} (sattuman odotus {fmtFi(sm.expectedHitsAt1)}) · väärin {sm.folds - sm.hitsAt1}
          </dd>
          <dt>Keskisijoitus</dt>
          <dd>
            {fmtFi(sm.meanRank)} (sattuman odotus {fmtFi(sm.expectedMeanRank)})
          </dd>
          <dt>p vs. satunnainen valinta</dt>
          <dd>
            {fmtPfi(sm.pVsRandom)} ({run.pMethod ?? '–'})
          </dd>
          <dt>Ilman piin numeroita</dt>
          <dd className="mx-dd-text">
            {sm.randomStrings
              ? `satunnaisjonot: keskim. oikein ${fmtFi(sm.randomStrings.hitsAt1)}, keskisijoitus ${fmtFi(sm.randomStrings.meanRank)} · π ${
                  run.piBeatsRandomStrings ? 'parempi' : 'ei parempi'
                } kuin satunnaisjonot`
              : 'satunnaisjonoja ei ajettu'}
          </dd>
          {run.randomStringRuns.length > 0 && (
            <>
              <dt>Jonoittain</dt>
              <dd className="mx-dd-text">
                {run.randomStringRuns.map((r) => `${r.label}: oikein ${r.hitsAt1}, keskisij. ${fmtFi(r.meanRank)}`).join(' · ')}
              </dd>
            </>
          )}
          <dt>Toisto</dt>
          <dd>
            D = {run.params.decoys}, siemen ”{run.seedText}” = {run.params.seed}, jonot {run.params.randomStrings}
            {run.params.kind === 'tapahtuma' ? `, muoto ${run.params.dateFormat}` : ''} · {run.version} · {fmtN(run.durationMs ?? 0)} ms
          </dd>
          <dt>SHA-256</dt>
          <dd>
            {run.hash.slice(0, 24)}… (lukittu {fmtDateTime(run.ts)}) · tulostiiviste {run.fingerprint ?? '–'}
          </dd>
        </dl>
      )}
      {run.exploratory && run.exploratoryReason && <div className="note warn mx-small">{run.exploratoryReason}</div>}
      {run.skipped.length > 0 && (
        <details className="pd-details">
          <summary>Ohitetut kohteet ({run.skipped.length})</summary>
          <ul className="pd-list">
            {run.skipped.map((s, i) => (
              <li key={i}>
                <b>{s.label || '–'}</b>: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {run.notes.length > 0 && (
        <ul className="pd-list faint" data-testid="blind-notes">
          {run.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <details className="pd-details">
        <summary>Menetelmä ({BLIND_VERSION})</summary>
        <div className="mx-small faint">{BLIND_DEFINITION}</div>
      </details>
    </section>
  );
}

function BlindHistory() {
  const runs = useApp((s) => s.matrix.path.blindRuns);
  const pathRuns = useApp((s) => s.matrix.path.runs);
  const counts = useApp((s) => s.matrix.path.counts);
  const selected = useApp((s) => s.matrix.path.selectedBlind);
  const m = pathTestsTotal(counts);
  const q = useMemo(() => {
    const ps = [
      ...pathRuns.filter((r) => r.kind === 'vertailu' && r.pValue != null).map((r) => ({ id: r.id, p: r.pValue as number })),
      ...runs.filter((r) => r.summary).map((r) => ({ id: r.id, p: r.summary!.pVsRandom })),
    ];
    const qs = pathBH(ps.map((x) => x.p), m);
    return new Map(ps.map((x, i) => [x.id, qs[i]]));
  }, [runs, pathRuns, m]);
  return (
    <section className="section" data-testid="blind-history" aria-label="Sokkotestien historia" style={{ gap: 8 }}>
      <div className="eyebrow">Kaikki sokkotestit ja monivertailu</div>
      <PathMultipleComparisonNote testId="blind-mc-note" />
      {runs.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Aika</th>
                <th>Kohteet</th>
                <th className="r">D</th>
                <th>Siemen</th>
                <th>Tila</th>
                <th className="r">Oikein</th>
                <th className="r">Väärin</th>
                <th className="r">p</th>
                <th className="r">q (BH)</th>
                <th>SHA-256</th>
                <th>Lukitus</th>
              </tr>
            </thead>
            <tbody>
              {[...runs].reverse().map((r) => {
                const correct = r.folds.filter((f) => f.correct).length;
                return (
                  <tr
                    key={r.id}
                    data-testid="blind-history-row"
                    className={`clickable${selected === r.id ? ' sel' : ''}${r.exploratory ? ' pd-row-exp' : ''}`}
                    onClick={() => selectBlindRun(r.id)}
                  >
                    <td className="mono">{fmtDateTime(r.ts)}</td>
                    <td>{r.params.kind}</td>
                    <td className="r mono">{r.params.decoys}</td>
                    <td className="mono">{r.seedText}</td>
                    <td>{r.status}</td>
                    <td className="r mono">{r.summary ? correct : '–'}</td>
                    <td className="r mono">{r.summary ? r.folds.length - correct : '–'}</td>
                    <td className="r mono">{r.summary ? fmtPfi(r.summary.pVsRandom) : '–'}</td>
                    <td className="r mono">{q.has(r.id) ? fmtPfi(q.get(r.id)!) : '–'}</td>
                    <td className="mono">{r.hash.slice(0, 10)}…</td>
                    <td title={r.exploratoryReason ?? ''}>{r.exploratory ? 'eksploratiivinen' : 'ennen tulosta'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
