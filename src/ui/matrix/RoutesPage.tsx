// Reitit-sivu: tallennetut reitit (π-faktat tarkistettuina) ja reittitesti satunnaisvertailulla
// (PIATLAS-ROUTE-1.0.0). Hypoteesin voi lukita SHA-256-tiivisteellä ennen ajoa (tämän laitteen kirjaus).
// Lukitus kattaa vain kysymyksen ensimmäisen ajon; kysymys on kanoninen (src/state/matrix.ts: routeQuestionKey).
// Ajon tila on storessa, joten eteneminen ja keskeytys näkyvät, vaikka sivulta poistutaan välillä.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { codeHits, expectedHits } from '../../core/matrix/hits';
import { ROUTE_ORDER_LABELS, RouteOrder } from '../../core/matrix/route-test';
import { HYPOTHESIS_LABELS, LAYER_LABELS, REALM_LABELS, ROUTE_TEST_VERSION, realmOf } from '../../core/matrix/types';
import { seedFrom } from '../../core/random';
import { cancelEngine } from '../../state/actions';
import {
  classifyRouteRun,
  evaluateRouteTiming,
  firstRouteCodes,
  lockForQuestion,
  NamedCode,
  namedCode,
  routeBH,
  routeCodesFromPath,
  routeCodesFromTrail,
  RouteRunSummary,
  taskDerivedReason,
} from '../../state/matrix';
import {
  deleteRoute,
  lockRouteHypothesis,
  openHitInMatrix,
  openRoute,
  runRouteTest,
  selectRouteRun,
  setRouteForm,
  setRouteTestError,
} from '../../state/matrix-actions';
import { useApp } from '../../state/store';
import { Histogram } from '../components/Histogram';
import { fiNum, fmtDateTime, fmtExpected, fmtN, fmtPct, fmtPfi } from '../format';
import { LayerBadge } from './bits';
import { shortLabel } from './labels';

/** Lukitus on tämän laitteen oma kirjaus: tiivistettä ja aikaleimaa ei todenneta ulkopuolisesti. */
const ON_DEVICE = 'lukittu tällä laitteella';

const VERDICT_CLASS: Record<string, string> = { 'ei-poikkeamaa': 'coded', eksploratiivinen: 'exp', 'lukittu-alle-alfa': 'stat' };
const fmtSpan = (x: number | null) => (x == null ? '∞ (mahdoton)' : `${fmtN(x)} des.`);

export function RoutesPage() {
  return (
    <>
      <SavedRoutes />
      <RouteTest />
    </>
  );
}

// ------------------------------------------------------------------ tallennetut reitit

function SavedRoutes() {
  const saved = useApp((s) => s.matrix.saved);
  const story = useApp((s) => s.matrix.story);
  const events = useApp((s) => s.events);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <section className="section" aria-label="Tallennetut reitit">
      <div className="eyebrow">Tallennetut reitit</div>
      {!saved.length && <div className="muted mx-small">Ei tallennettuja reittejä. Avaa reitti matriisissa ja paina ”Tallenna reitti”.</div>}
      {[...saved].reverse().map((r) => (
        <article key={r.id} className="card mx-saved" data-testid="matrix-saved-route">
          <div className="mx-saved-head">
            <b>{r.title}</b>
            <span className="mx-small faint">{fmtDateTime(r.createdAt)}</span>
          </div>
          <div className="mx-chips">
            <span className="mx-chip dir">suunta {r.direction}</span>
            <span className={`mx-chip ${r.hypothesis.timing === 'ennen-löydöstä' ? 'ok' : ''}`}>{HYPOTHESIS_LABELS[r.hypothesis.timing]}</span>
            {r.hypothesis.lockHash && (
              <span className="mx-chip mono" title="Lukitus on tämän laitteen oma kirjaus; tiivistettä ei todenneta ulkopuolisesti.">
                SHA-256 {r.hypothesis.lockHash.slice(0, 10)}… · {ON_DEVICE}
              </span>
            )}
            <span className="mx-chip">{r.crossings.length} kerrosvaihtoa</span>
            <span className="mx-chip mono">{r.matrixVersion}</span>
          </div>
          <div className="mx-mini-crumbs">
            {r.trail.map((st, i) => {
              const realm = realmOf(st.ref);
              const crossing = r.crossings.includes(i);
              // Jokaisen askeleen kerros (π-data / Tarinaverkko) ja yhteyden tyyppi, kuten elävässä murupolussa.
              const layer = st.via ? st.via.layer : 'matemaattinen';
              return (
                <Fragment key={i}>
                  {i > 0 && <span className={crossing ? 'mx-mini-div' : 'mx-sep'}>{crossing ? (realm === 'tarina' ? 'π | tarina' : 'tarina | π') : '›'}</span>}
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
                    <span className={`mx-mini-crumb r-${realm}`}>{shortLabel(st.ref, story, events)}</span>
                    <span
                      className={`mx-layer l-${layer}`}
                      data-testid="matrix-saved-step-layer"
                      title={st.via ? `${LAYER_LABELS[st.via.layer]}: ${st.via.relation}` : 'Lähtöankkuri'}
                    >
                      {REALM_LABELS[realm]} · {st.via ? LAYER_LABELS[st.via.layer] : 'lähtö'}
                    </span>
                  </span>
                </Fragment>
              );
            })}
          </div>
          {r.interpretation && (
            <div className="mx-interp">
              <span className="mx-layer l-symbolinen">Oma tulkinta</span> {r.interpretation}
            </div>
          )}
          {r.hypothesis.note && <div className="mx-small faint">{r.hypothesis.note}</div>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="eyebrow">π-faktat tallennushetkellä</span>
            <LayerBadge layer="matemaattinen" />
          </div>
          <ul className="mx-factlist">
            {r.mathFacts.map((f) => (
              <li key={f} className={f.includes('✗') ? 'bad' : ''}>
                {f}
              </li>
            ))}
            {!r.mathFacts.length && <li className="faint">Reitillä ei ollut π-kerroksen solmuja.</li>}
          </ul>
          <div className="mx-btn-row">
            <button type="button" className="mx-btn" onClick={() => openRoute(r.id)}>
              Avaa reitti
            </button>
            {confirm === r.id ? (
              <>
                <button type="button" className="mx-btn danger" onClick={() => deleteRoute(r.id)}>
                  Poista
                </button>
                <button type="button" className="mx-btn ghost" onClick={() => setConfirm(null)}>
                  Peru
                </button>
              </>
            ) : (
              <button type="button" className="mx-btn danger" onClick={() => setConfirm(r.id)}>
                Poista
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------ reittitesti

interface Source {
  id: string;
  label: string;
  codes: NamedCode[];
  /** Tehtävänannon lähteen nimi (ensimmäinen testireitti tai tehtävänannon polku): ajoitus on aina 'löydön-jälkeen'. */
  task: string | null;
}

function RouteTest() {
  const story = useApp((s) => s.matrix.story);
  const saved = useApp((s) => s.matrix.saved);
  const trail = useApp((s) => s.matrix.trail);
  const runs = useApp((s) => s.matrix.routeRuns);
  const runIndex = useApp((s) => s.matrix.runIndex);
  const locks = useApp((s) => s.matrix.locks);
  const rt = useApp((s) => s.matrix.routeTest);
  const digits = useApp((s) => s.digits);
  const sha = useApp((s) => s.dataset.info?.sha256 ?? null);
  const engineMode = useApp((s) => s.engineMode);
  // Lomake ja ajon tila ovat storessa (säilyvät, kun sivulta poistutaan); vain lisäyskenttä on paikallinen.
  const { sourceId, excluded, extra, order, R, seedText, strings, hyp } = rt.form;
  const running = rt.running;
  const [extraText, setExtraText] = useState('');

  const sources: Source[] = useMemo(
    () => [
      {
        id: 'first',
        label: 'Ensimmäinen testireitti: MAX → HANNA → SALLA → IDA',
        codes: firstRouteCodes(),
        task: 'ensimmäinen testireitti MAX → HANNA → SALLA → IDA',
      },
      ...story.paths.map((p) => {
        const names = p.steps.map((s) => s.name).join(' → ');
        return {
          id: `path:${p.id}`,
          label: `${p.title} · ${p.theme || '–'}: ${names}`,
          codes: routeCodesFromPath(p),
          task: p.source === 'tehtävänanto' ? `${p.title}: ${names}` : null,
        };
      }),
      { id: 'trail', label: 'Nykyinen murupolku', codes: routeCodesFromTrail(trail, story), task: null },
      ...saved.map((r) => ({ id: `saved:${r.id}`, label: `Tallennettu: ${r.title}`, codes: routeCodesFromTrail(r.trail, story), task: null })),
    ],
    [story, saved, trail],
  );

  const source = sources.find((s) => s.id === sourceId) ?? sources[0];
  const all = [...source.codes, ...extra.filter((c) => !source.codes.some((x) => x.code === c.code))];
  const codes = all.filter((c) => !excluded.includes(c.code));
  const codesKey = all.map((c) => c.code).join(',');
  const counts = useMemo(
    () => new Map(codesKey.split(',').filter(Boolean).map((c) => [c, codeHits(digits, c).length])),
    [codesKey, digits],
  );
  const cs = codes.map((c) => c.code);
  // Lukitus haetaan kanonisella kysymysavaimella; saman kysymyksen ensimmäinen lukitus ratkaisee.
  const lock = lockForQuestion(locks, cs, order, sha);
  const preview = evaluateRouteTiming(lock, runIndex, cs, order, sha, taskDerivedReason(cs, story, source.task));
  const defaultHyp = `Reitin ${codes.map((c) => c.name).join(' → ')} lyhin ikkuna (järjestys ${order}) on lyhyempi kuin 95 % nollamalleista (α = 0,05).`;
  const canRun = codes.length >= 2 && codes.every((c) => (counts.get(c.code) ?? 0) > 0) && !running;

  const run = () => {
    if (!canRun) return;
    void runRouteTest({ codes, order, R, seedText, randomStrings: strings, taskSource: source.task });
  };

  const shownRun = runs.find((r) => r.id === rt.selected) ?? null;

  return (
    <section className="section" aria-label="Reittitesti">
      <div className="eyebrow">Reittitesti satunnaisvertailulla · {ROUTE_TEST_VERSION}</div>
      <div className="muted mx-small">
        Testisuure on lyhin ikkuna: jokaiselle koodille valitaan yksi osuma ja minimoidaan max(n) − min(n). Kaikki osumat
        ovat mukana, joten ankkuria ei käytetä. Nollamallissa samat osumamäärät sijoitetaan satunnaisesti näkyvällä
        siemenellä.
      </div>
      <div className="card section mx-route-form" data-testid="matrix-route-test" style={{ gap: 12 }}>
        <label className="field">
          <span>REITIN KOODIT LÄHTEESTÄ</span>
          <select
            className="input"
            id="mx-route-source"
            value={source.id}
            onChange={(e) => setRouteForm({ sourceId: e.target.value, excluded: [] })}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mx-code-chips" role="group" aria-label="Reitin koodit">
          {all.map((c) => {
            const on = !excluded.includes(c.code);
            const k = counts.get(c.code) ?? 0;
            return (
              <button
                key={c.code}
                type="button"
                className="toggle mx-code-chip"
                aria-pressed={on}
                onClick={() => setRouteForm({ excluded: on ? [...excluded, c.code] : excluded.filter((x) => x !== c.code) })}
              >
                <span className="dot" />
                {on ? `${codes.indexOf(c) + 1}. ` : ''}
                {c.name} <span className="mono">{c.code}</span>
                <span className="faint">
                  {' '}
                  · {fmtN(k)} os. (odotus {fmtExpected(expectedHits(digits.length, c.code.length))})
                </span>
              </button>
            );
          })}
          {!all.length && <span className="mx-small faint">Lähteessä ei ole koodattavia nimiä.</span>}
        </div>
        <form
          className="mx-btn-row"
          onSubmit={(e) => {
            e.preventDefault();
            const c = namedCode(extraText);
            if (!c) {
              setRouteTestError(`"${extraText}" ei ole koodattavissa (T9 tai numerojono).`);
              return;
            }
            setRouteTestError(null);
            setRouteForm({ extra: [...extra.filter((x) => x.code !== c.code), c] });
            setExtraText('');
          }}
        >
          <input
            className="input"
            style={{ flex: '1 1 140px', width: 'auto' }}
            id="mx-route-extra"
            aria-label="Lisää nimi tai koodi reitille"
            value={extraText}
            placeholder="lisää nimi tai koodi"
            onChange={(e) => setExtraText(e.target.value)}
          />
          <button type="submit" className="mx-btn" disabled={!extraText.trim()}>
            Lisää
          </button>
        </form>
        <div className="mx-form-grid">
          <label className="field">
            <span>JÄRJESTYS</span>
            <select className="input" id="mx-route-order" value={order} onChange={(e) => setRouteForm({ order: e.target.value as RouteOrder })}>
              <option value="mikä-tahansa">mikä tahansa</option>
              <option value="234">234 (kasvava n)</option>
              <option value="432">432 (pienenevä n)</option>
            </select>
          </label>
          <label className="field">
            <span>TOISTOT R</span>
            <select className="input" id="mx-route-r" value={R} onChange={(e) => setRouteForm({ R: Number(e.target.value) })}>
              {[200, 1000, 5000].map((r) => (
                <option key={r} value={r}>
                  {fmtN(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>SIEMEN</span>
            <input className="input mono" id="mx-route-seed" value={seedText} onChange={(e) => setRouteForm({ seedText: e.target.value })} />
          </label>
          <label className="field">
            <span>SATUNNAISJONOT</span>
            <select className="input" id="mx-route-strings" value={strings} onChange={(e) => setRouteForm({ strings: Number(e.target.value) })}>
              {[0, 10, 20].map((x) => (
                <option key={x} value={x}>
                  {x} jonoa
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mx-small faint">
          {ROUTE_ORDER_LABELS[order]}. Siemen {seedFrom(seedText)} (numeerinen arvo). Laskenta:{' '}
          {engineMode === 'worker' ? 'Web Worker' : engineMode === 'inline' ? 'pääsäie' : 'käynnistyy…'}.
        </div>

        <div className="mx-lock">
          <div className="eyebrow">Hypoteesin lukitus ennen ajoa (valinnainen)</div>
          <div className="mx-small faint">
            Lukitus tallentaa hypoteesin, koodit, järjestyksen ja aikaleiman SHA-256-tiivisteenä tälle laitteelle (oma
            kirjaus, ei ulkopuolista todennusta). Ajoituksen ”{HYPOTHESIS_LABELS['ennen-löydöstä']}” saa vain lukitusta
            seuraava ensimmäinen ajo, ja vain jos samaa koodijoukkoa ei ole ajettu millään järjestyksellä. Myöhemmät ajot
            (eri siemen tai R) ovat eksploratiivisia, ja tehtävänannon reitit ovat aina ”{HYPOTHESIS_LABELS['löydön-jälkeen']}”.
            Valitse siksi riittävä R ennen lukittua ajoa.
          </div>
          <textarea className="input" id="mx-route-hyp" value={hyp} placeholder={defaultHyp} onChange={(e) => setRouteForm({ hyp: e.target.value })} />
          <button
            type="button"
            className="mx-btn"
            data-testid="matrix-route-lock"
            disabled={codes.length < 2}
            onClick={async () => {
              await lockRouteHypothesis((hyp || defaultHyp).trim(), codes, order, source.task);
              setRouteForm({ hyp: '' });
            }}
          >
            Lukitse hypoteesi
          </button>
          {lock && (
            <div className="card flat mx-small" style={{ padding: 10 }}>
              <div className="mono faint">
                {fmtDateTime(lock.createdAt)} · SHA-256 {lock.hash.slice(0, 16)}… · {ON_DEVICE}
              </div>
              <div>{lock.text}</div>
            </div>
          )}
          <div className={`note ${preview.preregistered ? '' : 'warn'}`} data-testid="matrix-route-timing">
            Tämän ajon hypoteesin ajoitus: <b>{HYPOTHESIS_LABELS[preview.timing]}</b>
            {preview.preregistered ? ` (${ON_DEVICE})` : ''}. {preview.reason}
          </div>
        </div>

        <button type="button" className="btn primary" data-testid="matrix-route-run" disabled={!canRun} onClick={run}>
          {running ? 'Reittitesti käynnissä…' : 'Aja reittitesti'}
        </button>
        {codes.length < 2 && <div className="mx-small faint">Valitse vähintään kaksi koodia.</div>}
        {running && (
          <div className="section" style={{ gap: 6 }} data-testid="matrix-route-running">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">
                Reittitesti: {fmtN(running.done)} / {fmtN(running.total)}
              </span>
              <button type="button" className="mx-btn ghost" data-testid="matrix-route-cancel" onClick={() => void cancelEngine()}>
                Keskeytä
              </button>
            </div>
            <div className="mx-small faint">{running.label}</div>
            <div className="progress">
              <i style={{ width: `${(100 * running.done) / Math.max(1, running.total)}%` }} />
            </div>
          </div>
        )}
        {rt.error && <div className="note err">{rt.error}</div>}
      </div>

      {shownRun && <RouteResult run={shownRun} nullValues={rt.last && rt.last.id === shownRun.id ? rt.last.nullValues : null} />}
      <RunList runs={runs} total={runIndex.total} selected={rt.selected} onSelect={selectRouteRun} />
    </section>
  );
}

function RouteResult({ run, nullValues }: { run: RouteRunSummary; nullValues: Float64Array | null }) {
  const prereg = run.timing === 'ennen-löydöstä' && !!run.lockHash;
  // Luokitus lasketaan uudelleen: ennalta lukittu p ≤ α vaatii myös Wilsonin ylärajan ≤ α.
  const v = classifyRouteRun(run);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [run.id]);
  return (
    <div ref={ref} className="card section mx-route-result" data-testid="matrix-route-result" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className={`pill ${VERDICT_CLASS[v.verdict]}`}>{v.title}</span>
        <span className="pill">
          {HYPOTHESIS_LABELS[run.timing]}
          {prereg ? ` · ${ON_DEVICE}` : ''}
        </span>
      </div>
      <div style={{ fontSize: 13.5 }}>{fiNum(v.text)}</div>
      <dl className="kv">
        <dt>Reitti</dt>
        <dd>
          {run.names.map((n, i) => `${n} ${run.codes[i]}`).join(' → ')} · {run.order}
        </dd>
        <dt>Lyhin ikkuna</dt>
        <dd>
          {fmtSpan(run.span)}
          {run.picks && ` (n ${fmtN(Math.min(...run.picks))} … ${fmtN(Math.max(...run.picks))})`}
        </dd>
        <dt>p (Monte Carlo)</dt>
        <dd>
          {fmtPfi(run.pValue)} · 95 % väli (Wilson) {fmtPfi(run.pLow)}–{fmtPfi(run.pHigh)}
        </dd>
        <dt>Lyhyempi kuin</dt>
        <dd>{fmtPct(run.shareGreater)} nollamalleista</dd>
        <dt>Nollamalli</dt>
        <dd>
          mediaani {fmtSpan(run.nullMedian)} · 5–95 % {fmtSpan(run.nullQ05)} – {fmtSpan(run.nullQ95)}
          {run.impossibleNull > 0 && ` · mahdottomia ${fmtN(run.impossibleNull)}`}
        </dd>
        {run.randomShareLE != null && (
          <>
            <dt>Satunnaisjonot</dt>
            <dd>
              {run.randomStrings} jonoa: {fmtPct(run.randomShareLE)} yhtä lyhyt tai lyhyempi ikkuna
            </dd>
          </>
        )}
        <dt>Osumamäärät</dt>
        <dd>
          {run.names.map((n, i) => `${n} ${fmtN(run.counts[i])} (odotus ${fmtExpected(run.expected[i] ?? NaN)})`).join(' · ')}
        </dd>
        <dt>Toisto</dt>
        <dd>
          R={fmtN(run.R)}, siemen ”{run.seedText}” = {run.seed}, {run.version}, {fmtN(run.durationMs)} ms
        </dd>
        <dt>Ajoitus</dt>
        <dd className="mx-dd-text">
          {HYPOTHESIS_LABELS[run.timing]} — {run.timingReason}
        </dd>
      </dl>
      {run.picks && (
        <div className="section" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="eyebrow">Ikkunan valinnat (avaa osumasolmuna)</span>
            <LayerBadge layer="matemaattinen" />
          </div>
          <div className="mx-btn-row">
            {run.picks.map((n, i) => (
              <button
                key={`${run.codes[i]}-${n}`}
                type="button"
                className="mx-btn"
                data-testid="matrix-route-pick"
                onClick={() => openHitInMatrix(run.codes[i], n, run.names[i])}
              >
                {run.names[i]} {run.codes[i]} @{fmtN(n)} {run.picksVerified?.[i] ? '✓' : '✗'}
              </button>
            ))}
          </div>
        </div>
      )}
      {nullValues && run.span != null && <Histogram values={nullValues} observed={run.span} metric="1d" label="havaittu ikkuna" />}
      <div className="mx-small faint">{run.definition}</div>
    </div>
  );
}

function RunList({
  runs,
  total,
  selected,
  onSelect,
}: {
  runs: RouteRunSummary[];
  /** Kaikkien ajojen määrä (rajaamaton hakemisto); `runs` voi olla rajattu. */
  total: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const m = Math.max(total, runs.length);
  const q = useMemo(() => routeBH(runs.map((r) => r.pValue), m), [runs, m]);
  if (!runs.length) return <div className="muted mx-small">Ei vielä ajettuja reittitestejä. Jokainen ajo kirjataan monivertailua varten.</div>;
  const older = m - runs.length;
  return (
    <div className="section" style={{ gap: 8 }}>
      <div className="eyebrow">Reittitestien loki ja monivertailu</div>
      <div className="note warn" data-testid="matrix-route-mc-warning">
        Matriisin reittitestejä ajettu {m}. Jos testejä on m kappaletta, noin m·α niistä antaa p ≤ α pelkällä sattumalla
        (nyt {(m * 0.05).toFixed(1).replace('.', ',')}, kun α = 0,05). Raportoi kaikki, ei vain parhaita.
        {older > 0 &&
          ` Taulukossa on ${runs.length} uusinta ajoa. ${older} vanhemman ajon p-arvot on tiivistetty (tallessa vain kysymys, ` +
            `ensimmäisen ajon aika ja määrä). BH-q käyttää m = ${m} ja olettaa puuttuvat p-arvot ykkösiksi (varovainen arvio).`}
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Aika</th>
              <th>Reitti</th>
              <th>Järj.</th>
              <th className="r">R</th>
              <th className="r">Ikkuna</th>
              <th className="r">p</th>
              <th className="r">q (BH)</th>
              <th>Ajoitus</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.id} className={`clickable${selected === r.id ? ' sel' : ''}`} onClick={() => onSelect(r.id)}>
                <td className="mono">{fmtDateTime(r.ts)}</td>
                <td>{r.names.join(' → ')}</td>
                <td>{r.order}</td>
                <td className="r mono">{fmtN(r.R)}</td>
                <td className="r mono">{r.span == null ? '∞' : fmtN(r.span)}</td>
                <td className="r mono">{fmtPfi(r.pValue)}</td>
                <td className="r mono">{fmtPfi(q[i])}</td>
                <td>{r.timing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
