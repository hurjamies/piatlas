// Reitit-sivu: tallennetut reitit (π-faktat tarkistettuina) ja reittitesti satunnaisvertailulla
// (PIATLAS-ROUTE-1.0.0). Hypoteesin voi lukita SHA-256-tiivisteellä ennen ajoa; ajoitussääntö on sama kuin
// Testit-välilehden esirekisteröinnissä.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { codeHits, expectedHits } from '../../core/matrix/hits';
import { ROUTE_ORDER_LABELS, RouteOrder, RouteTestResult } from '../../core/matrix/route-test';
import { HYPOTHESIS_LABELS, ROUTE_TEST_VERSION, realmOf } from '../../core/matrix/types';
import { seedFrom } from '../../core/random';
import { benjaminiHochberg, classify } from '../../core/stats';
import { cancelEngine } from '../../state/actions';
import {
  evaluateRouteTiming,
  firstRouteCodes,
  NamedCode,
  namedCode,
  routeCodesFromPath,
  routeCodesFromTrail,
  routeQuestionKey,
  RouteRunSummary,
} from '../../state/matrix';
import { deleteRoute, lockRouteHypothesis, openHitInMatrix, openRoute, runRouteTest } from '../../state/matrix-actions';
import { useApp } from '../../state/store';
import { Histogram } from '../components/Histogram';
import { fiNum, fmtDateTime, fmtExpected, fmtN, fmtPct, fmtPfi } from '../format';
import { shortLabel } from './labels';

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
            {r.hypothesis.lockHash && <span className="mx-chip mono">SHA-256 {r.hypothesis.lockHash.slice(0, 10)}…</span>}
            <span className="mx-chip">{r.crossings.length} kerrosvaihtoa</span>
            <span className="mx-chip mono">{r.matrixVersion}</span>
          </div>
          <div className="mx-mini-crumbs">
            {r.trail.map((st, i) => {
              const realm = realmOf(st.ref);
              const crossing = r.crossings.includes(i);
              return (
                <Fragment key={i}>
                  {i > 0 && <span className={crossing ? 'mx-mini-div' : 'mx-sep'}>{crossing ? (realm === 'tarina' ? 'π | tarina' : 'tarina | π') : '›'}</span>}
                  <span className={`mx-mini-crumb r-${realm}`}>{shortLabel(st.ref, story, events)}</span>
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
          <div className="eyebrow">π-faktat tallennushetkellä</div>
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
}

function RouteTest() {
  const story = useApp((s) => s.matrix.story);
  const saved = useApp((s) => s.matrix.saved);
  const trail = useApp((s) => s.matrix.trail);
  const runs = useApp((s) => s.matrix.routeRuns);
  const locks = useApp((s) => s.matrix.locks);
  const digits = useApp((s) => s.digits);
  const sha = useApp((s) => s.dataset.info?.sha256 ?? null);
  const engineMode = useApp((s) => s.engineMode);

  const sources: Source[] = useMemo(
    () => [
      { id: 'first', label: 'Ensimmäinen testireitti: MAX → HANNA → SALLA → IDA', codes: firstRouteCodes() },
      ...story.paths.map((p) => ({
        id: `path:${p.id}`,
        label: `${p.title} · ${p.theme || '–'}: ${p.steps.map((s) => s.name).join(' → ')}`,
        codes: routeCodesFromPath(p),
      })),
      { id: 'trail', label: 'Nykyinen murupolku', codes: routeCodesFromTrail(trail, story) },
      ...saved.map((r) => ({ id: `saved:${r.id}`, label: `Tallennettu: ${r.title}`, codes: routeCodesFromTrail(r.trail, story) })),
    ],
    [story, saved, trail],
  );
  const [sourceId, setSourceId] = useState('first');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [extra, setExtra] = useState<NamedCode[]>([]);
  const [extraText, setExtraText] = useState('');
  const [order, setOrder] = useState<RouteOrder>('mikä-tahansa');
  const [R, setR] = useState(1000);
  const [seedText, setSeedText] = useState('20261016');
  const [strings, setStrings] = useState(0);
  const [hyp, setHyp] = useState('');
  const [running, setRunning] = useState<null | { done: number; total: number }>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ id: string; result: RouteTestResult } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const source = sources.find((s) => s.id === sourceId) ?? sources[0];
  const all = [...source.codes, ...extra.filter((c) => !source.codes.some((x) => x.code === c.code))];
  const codes = all.filter((c) => !excluded.includes(c.code));
  const codesKey = all.map((c) => c.code).join(',');
  const counts = useMemo(
    () => new Map(codesKey.split(',').filter(Boolean).map((c) => [c, codeHits(digits, c).length])),
    [codesKey, digits],
  );
  const cs = codes.map((c) => c.code);
  const key = routeQuestionKey(cs, order, sha);
  const lock = [...locks].reverse().find((l) => routeQuestionKey(l.codes, l.order, l.datasetSha) === key) ?? null;
  const preview = evaluateRouteTiming(lock, runs, cs, order, sha);
  const defaultHyp = `Reitin ${codes.map((c) => c.name).join(' → ')} lyhin ikkuna (järjestys ${order}) on lyhyempi kuin 95 % nollamalleista (α = 0,05).`;
  const canRun = codes.length >= 2 && codes.every((c) => (counts.get(c.code) ?? 0) > 0) && !running;

  const run = async () => {
    setError(null);
    setRunning({ done: 0, total: R + strings });
    try {
      const { result, summary } = await runRouteTest({ codes, order, R, seedText, randomStrings: strings, lockId: lock?.id ?? null }, (done, total) =>
        setRunning({ done, total }),
      );
      setLast({ id: summary.id, result });
      setSelected(summary.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const shownRun = runs.find((r) => r.id === selected) ?? null;

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
            onChange={(e) => {
              setSourceId(e.target.value);
              setExcluded([]);
            }}
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
                onClick={() => setExcluded(on ? [...excluded, c.code] : excluded.filter((x) => x !== c.code))}
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
              setError(`"${extraText}" ei ole koodattavissa (T9 tai numerojono).`);
              return;
            }
            setError(null);
            setExtra([...extra.filter((x) => x.code !== c.code), c]);
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
            <select className="input" id="mx-route-order" value={order} onChange={(e) => setOrder(e.target.value as RouteOrder)}>
              <option value="mikä-tahansa">mikä tahansa</option>
              <option value="234">234 (kasvava n)</option>
              <option value="432">432 (pienenevä n)</option>
            </select>
          </label>
          <label className="field">
            <span>TOISTOT R</span>
            <select className="input" id="mx-route-r" value={R} onChange={(e) => setR(Number(e.target.value))}>
              {[200, 1000, 5000].map((r) => (
                <option key={r} value={r}>
                  {fmtN(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>SIEMEN</span>
            <input className="input mono" id="mx-route-seed" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
          </label>
          <label className="field">
            <span>SATUNNAISJONOT</span>
            <select className="input" id="mx-route-strings" value={strings} onChange={(e) => setStrings(Number(e.target.value))}>
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
            Lukitus tallentaa hypoteesin, koodit, järjestyksen ja aikaleiman SHA-256-tiivisteenä. Vain ennen saman
            reittikysymyksen ensimmäistä ajoa lukittu hypoteesi saa ajoituksen ”{HYPOTHESIS_LABELS['ennen-löydöstä']}”.
          </div>
          <textarea className="input" id="mx-route-hyp" value={hyp} placeholder={defaultHyp} onChange={(e) => setHyp(e.target.value)} />
          <button
            type="button"
            className="mx-btn"
            data-testid="matrix-route-lock"
            disabled={codes.length < 2}
            onClick={async () => {
              await lockRouteHypothesis((hyp || defaultHyp).trim(), codes, order);
              setHyp('');
            }}
          >
            Lukitse hypoteesi
          </button>
          {lock && (
            <div className="card flat mx-small" style={{ padding: 10 }}>
              <div className="mono faint">
                {fmtDateTime(lock.createdAt)} · SHA-256 {lock.hash.slice(0, 16)}…
              </div>
              <div>{lock.text}</div>
            </div>
          )}
          <div className={`note ${preview.preregistered ? '' : 'warn'}`} data-testid="matrix-route-timing">
            Tämän ajon hypoteesin ajoitus: <b>{HYPOTHESIS_LABELS[preview.timing]}</b>. {preview.reason}
          </div>
        </div>

        <button type="button" className="btn primary" data-testid="matrix-route-run" disabled={!canRun} onClick={run}>
          Aja reittitesti
        </button>
        {codes.length < 2 && <div className="mx-small faint">Valitse vähintään kaksi koodia.</div>}
        {running && (
          <div className="section" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">
                Reittitesti: {fmtN(running.done)} / {fmtN(running.total)}
              </span>
              <button type="button" className="mx-btn ghost" onClick={() => void cancelEngine()}>
                Keskeytä
              </button>
            </div>
            <div className="progress">
              <i style={{ width: `${(100 * running.done) / Math.max(1, running.total)}%` }} />
            </div>
          </div>
        )}
        {error && <div className="note err">{error}</div>}
      </div>

      {shownRun && <RouteResult run={shownRun} nullValues={last && last.id === shownRun.id ? last.result.nullValues : null} />}
      <RunList runs={runs} selected={selected} onSelect={setSelected} />
    </section>
  );
}

function RouteResult({ run, nullValues }: { run: RouteRunSummary; nullValues: Float64Array | null }) {
  const prereg = run.timing === 'ennen-löydöstä' && !!run.lockHash;
  const v = classify(run.pValue, run.alpha, prereg);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [run.id]);
  return (
    <div ref={ref} className="card section mx-route-result" data-testid="matrix-route-result" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className={`pill ${VERDICT_CLASS[v.verdict]}`}>{v.title}</span>
        <span className="pill">{HYPOTHESIS_LABELS[run.timing]}</span>
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
          <div className="eyebrow">Ikkunan valinnat (avaa osumasolmuna)</div>
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

function RunList({ runs, selected, onSelect }: { runs: RouteRunSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  const q = useMemo(() => benjaminiHochberg(runs.map((r) => r.pValue)), [runs]);
  if (!runs.length) return <div className="muted mx-small">Ei vielä ajettuja reittitestejä. Jokainen ajo kirjataan monivertailua varten.</div>;
  const m = runs.length;
  return (
    <div className="section" style={{ gap: 8 }}>
      <div className="eyebrow">Reittitestien loki ja monivertailu</div>
      <div className="note warn" data-testid="matrix-route-mc-warning">
        Matriisin reittitestejä ajettu {m}. Jos testejä on m kappaletta, noin m·α niistä antaa p ≤ α pelkällä sattumalla
        (nyt {(m * 0.05).toFixed(1).replace('.', ',')}, kun α = 0,05). Raportoi kaikki, ei vain parhaita.
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
