import { useMemo, useRef, useState } from 'react';
import { PI_1M_SHA256 } from '../../core/digits';
import { METRIC_LABELS, Metric } from '../../core/geometry-index';
import { mapIndex } from '../../core/mapping';
import { findAll } from '../../core/search';
import { seedFrom } from '../../core/random';
import {
  benjaminiHochberg,
  bonferroni,
  classify,
  MCResult,
  RandomControlResult,
  Statistic,
  STATISTIC_HELP,
  STATISTIC_LABELS,
} from '../../core/stats';
import { PreRegistration, sameQuestion, TestRun, TestSpec } from '../../core/types';
import { FORMULA_TEXT, FORMULA_VERSION, ENCODING_VERSION, LEGACY_FORMULA_TEXT, NET_VERSION, STATS_VERSION } from '../../core/version';
import {
  cancelEngine,
  clearRuns,
  importDatasetFile,
  lockPreregistration,
  revertToBundled,
  runMonteCarloTest,
  runRandomControlTest,
  toast,
} from '../../state/actions';
import { buildReport, hitsCsv } from '../../state/report';
import { store, useApp } from '../../state/store';
import { fiNum, fmtDateTime, fmtExpected, fmtMetric, fmtN, fmtPct, fmtPfi } from '../format';
import { Histogram } from '../components/Histogram';

declare const __BUILD_TARGET__: string;
const IS_ARTIFACT = typeof __BUILD_TARGET__ !== 'undefined' && __BUILD_TARGET__ === 'artifact';

export function TestsView() {
  return (
    <div className="view scroll" data-testid="tests-view">
      <div className="page">
        <ProximityTest />
        <TestLog />
        <SelfChecks />
        <DatasetSection />
        <ExportSection />
        <FormulaSection />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ läheisyystesti

const VERDICT_CLASS: Record<string, string> = {
  'ei-poikkeamaa': 'coded',
  eksploratiivinen: 'exp',
  'lukittu-alle-alfa': 'stat',
};

function ProximityTest() {
  const terms = useApp((s) => s.terms);
  const hits = useApp((s) => s.hits);
  const anchor = useApp((s) => s.anchor);
  const info = useApp((s) => s.dataset.info);
  const prereg = useApp((s) => s.prereg);
  const runs = useApp((s) => s.runs);
  const engineMode = useApp((s) => s.engineMode);
  const [termB, setTermB] = useState('matti');
  const [termA, setTermA] = useState(anchor.termId);
  const [metric, setMetric] = useState<Metric>('3d');
  const [statistic, setStatistic] = useState<Statistic>('anchorNearest');
  const [R, setR] = useState(1000);
  const [seedText, setSeedText] = useState('20251016');
  const [alpha, setAlpha] = useState(0.05);
  const [running, setRunning] = useState<null | { label: string; done: number; total: number }>(null);
  const [result, setResult] = useState<{ mc?: MCResult; rc?: RandomControlResult; run: TestRun; prereg: PreRegistration | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hypothesis, setHypothesis] = useState('');
  const [rcStrings, setRcStrings] = useState(50);

  const effA = statistic === 'anchorNearest' ? anchor.termId : termA;
  const tA = terms.find((t) => t.id === effA);
  const tB = terms.find((t) => t.id === termB);
  const hA = hits[effA];
  const hB = hits[termB];
  const ready = !!(hA?.status === 'ready' && hB?.status === 'ready' && info && hB.count > 0 && hA.count > 0);
  const seed = seedFrom(seedText);
  const spec: TestSpec | null = ready
    ? {
        termA: effA,
        termB,
        labelA: tA?.label ?? effA,
        labelB: tB?.label ?? termB,
        codeA: hA!.code,
        codeB: hB!.code,
        metric,
        statistic,
        anchorN: statistic === 'anchorNearest' ? anchor.n : null,
        R,
        seed,
        alpha,
        datasetSha: info!.sha256,
        datasetLength: info!.length,
      }
    : null;

  const defaultHyp = spec
    ? statistic === 'anchorNearest'
      ? `Ankkurin ${spec.labelA}@${anchor.n} lähin ${spec.labelB} (${metric.toUpperCase()}) on lähempänä kuin ${fmtPct(1 - alpha, 0)} nollamalleista (R=${R}, siemen ${seed}).`
      : `Lähin ${spec.labelA}–${spec.labelB}-pari (${metric.toUpperCase()}, ${STATISTIC_LABELS[statistic].split(' · ')[0]}) on lähempänä kuin ${fmtPct(1 - alpha, 0)} nollamalleista (R=${R}, siemen ${seed}).`
    : '';

  const run = async (s: TestSpec, pr: PreRegistration | null) => {
    setError(null);
    setResult(null);
    setRunning({ label: 'Monte Carlo', done: 0, total: s.R });
    try {
      // Esirekisteröinti on voimassa vain, jos samaa testiä ei ajettu ennen lukitusta.
      const ranBefore = pr ? store.get().runs.some((r) => sameQuestion(r.spec, s) && r.ts < pr.createdAt) : false;
      const { result: mc, run: r } = await runMonteCarloTest(s, pr && !ranBefore ? pr.id : null, (done, total) =>
        setRunning({ label: 'Monte Carlo', done, total }),
      );
      setResult({ mc, run: r, prereg: pr && !ranBefore ? pr : null });
      if (pr && ranBefore) toast('Sama kysymys ajettiin jo ennen lukitusta: tulos merkitään eksploratiiviseksi.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const runRc = async () => {
    if (!spec) return;
    setError(null);
    setResult(null);
    setRunning({ label: 'Satunnaisjonot', done: 0, total: rcStrings });
    try {
      const { result: rc, run: r } = await runRandomControlTest(spec, rcStrings, (done, total) =>
        setRunning({ label: 'Satunnaisjonot', done, total }),
      );
      setResult({ rc, run: r, prereg: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const lock = async () => {
    if (!spec) return;
    const p = await lockPreregistration((hypothesis || defaultHyp).trim(), spec);
    setHypothesis('');
    toast(`Hypoteesi lukittu (${p.hash.slice(0, 10)}…). Aja se alta.`);
  };

  const pending = prereg.filter((p) => !runs.some((r) => r.preregId === p.id || (sameQuestion(r.spec, p.spec) && r.ts >= p.createdAt && r.spec.seed === p.spec.seed)));
  const alreadyAsked = spec ? runs.some((r) => sameQuestion(r.spec, spec)) : false;
  const askedBefore = (p: PreRegistration) => runs.some((r) => sameQuestion(r.spec, p.spec) && r.ts < p.createdAt);

  return (
    <div className="section">
      <div className="eyebrow">Tilastollinen kontrolli</div>
      <h2 className="h2">Kontrolloitu läheisyystesti</h2>
      <div className="muted" style={{ fontSize: 13.5 }}>
        Onko havaittu läheisyys harvinainen? Verrataan sitä nollamalliin, jossa samat osumamäärät sijoitetaan
        satunnaisiin kohtiin 1…N näkyvällä siemenellä. Lyhyillä koodeilla on paljon osumia, joten ne ovat usein lähellä
        jotakin.
      </div>
      <div className="card section" style={{ gap: 12 }}>
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <label className="field">
            <span>TESTISUURE</span>
            <select id="mc-stat" className="input" value={statistic} onChange={(e) => setStatistic(e.target.value as Statistic)}>
              {(Object.keys(STATISTIC_LABELS) as Statistic[]).map((k) => (
                <option key={k} value={k}>
                  {STATISTIC_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>ETÄISYYS</span>
            <select id="mc-metric" className="input" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              {(Object.keys(METRIC_LABELS) as Metric[]).map((k) => (
                <option key={k} value={k}>
                  {METRIC_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{statistic === 'anchorNearest' ? 'A = ANKKURI' : 'TERMI A'}</span>
            {statistic === 'anchorNearest' ? (
              <input className="input" readOnly value={`${tA?.label ?? ''} @${fmtN(anchor.n)}`} />
            ) : (
              <select id="mc-a" className="input" value={termA} onChange={(e) => setTermA(e.target.value)}>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({hits[t.id]?.count ?? '…'})
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="field">
            <span>TERMI B</span>
            <select id="mc-b" className="input" value={termB} onChange={(e) => setTermB(e.target.value)}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({hits[t.id]?.count ?? '…'})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>TOISTOT R</span>
            <select id="mc-r" className="input" value={R} onChange={(e) => setR(Number(e.target.value))}>
              {[200, 1000, 2000, 5000, 10000].map((r) => (
                <option key={r} value={r}>
                  {fmtN(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>SIEMEN</span>
            <input id="mc-seed" className="input mono" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
          </label>
          <label className="field">
            <span>α</span>
            <select id="mc-alpha" className="input" value={alpha} onChange={(e) => setAlpha(Number(e.target.value))}>
              {[0.05, 0.01, 0.001].map((a) => (
                <option key={a} value={a}>
                  {String(a).replace('.', ',')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="faint" style={{ fontSize: 12.5 }}>
          {STATISTIC_HELP[statistic]} Siemen {seed} (numeerinen arvo). Laskenta:{' '}
          {engineMode === 'worker' ? 'Web Worker' : engineMode === 'inline' ? 'pääsäie (worker ei käytettävissä)' : 'käynnistyy…'}.
        </div>
        {statistic === 'anchorNearest' && anchor.termId === 'ida' && anchor.n === 858511 && (
          <div className="note warn">
            Ankkuri IDA@858 511 valittiin, koska MATTI@858 260 oli sen lähellä numerojonossa. Ankkuriehdollinen testi on
            siksi vinoutunut erityisesti 1D-etäisyydellä. Vertaa aina valintakorjattuun S2-testiin.
          </div>
        )}
        {hB && hB.status === 'ready' && hB.expected >= 20 && (
          <div className="note warn">
            {tB?.label} ({hB.code}) on lyhyt koodi: {fmtN(hB.count)} osumaa (odotus {fmtExpected(hB.expected)}). Jokin osuma
            on lähes aina lähellä.
          </div>
        )}
        <div className="row">
          <button className="btn primary" disabled={!spec || !!running} onClick={() => spec && run(spec, null)} data-testid="run-mc">
            Aja testi (eksploratiivinen)
          </button>
          <button className="btn" disabled={!spec || !!running} onClick={runRc} title="S1 käyttää satunnaisjonoissa S2:ta, koska niissä ei ole ankkuria">
            Satunnaisjonokontrolli
          </button>
          <select className="input" style={{ maxWidth: 120 }} aria-label="Satunnaisjonojen määrä" value={rcStrings} onChange={(e) => setRcStrings(Number(e.target.value))}>
            {[20, 50, 100, 200].map((x) => (
              <option key={x} value={x}>
                {x} jonoa
              </option>
            ))}
          </select>
        </div>
        {running && (
          <div className="section" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">
                {running.label}: {fmtN(running.done)} / {fmtN(running.total)}
              </span>
              <button className="btn small ghost" onClick={() => void cancelEngine()}>
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

      {result?.mc && <McResultCard mc={result.mc} run={result.run} prereg={result.prereg} />}
      {result?.rc && <RcResultCard rc={result.rc} />}

      <div className="card section" style={{ gap: 10 }}>
        <div className="eyebrow">Esirekisteröinti · lukitse kysymys ennen ajoa</div>
        <div className="faint" style={{ fontSize: 12.5 }}>
          Lukitus tallentaa hypoteesin, parametrit ja aikaleiman SHA-256-tiivisteenä. Vain lukittu testi voi saada
          tilan ”ennalta lukittu”. Kaikki muut ajot ovat eksploratiivisia.
        </div>
        <textarea
          id="prereg-text"
          className="input"
          value={hypothesis}
          placeholder={defaultHyp}
          onChange={(e) => setHypothesis(e.target.value)}
        />
        {alreadyAsked && (
          <div className="note warn">
            Tämä kysymys (samat termit, etäisyys, testisuure ja ankkuri) on jo ajettu. Lukitus ei enää tee siitä
            ennakkoon rekisteröityä, vaikka siemen vaihtuisi. Tulos merkitään eksploratiiviseksi.
          </div>
        )}
        <button className="btn" disabled={!spec} onClick={lock}>
          Lukitse hypoteesi nykyisillä asetuksilla
        </button>
        {pending.map((p) => (
          <div key={p.id} className="card flat section" style={{ gap: 6 }}>
            <div className="mono faint" style={{ fontSize: 11.5 }}>
              {fmtDateTime(p.createdAt)} · {p.hash.slice(0, 16)}…
            </div>
            <div>{p.hypothesis}</div>
            <div className="mono faint" style={{ fontSize: 11.5 }}>
              {p.spec.statistic} · {p.spec.metric} · {p.spec.labelA}–{p.spec.labelB} · R={p.spec.R} · siemen {p.spec.seed} · α={p.spec.alpha}
            </div>
            {askedBefore(p) && <div className="note warn">Kysymys ajettiin jo ennen lukitusta → tulos on eksploratiivinen.</div>}
            <button className="btn small primary" disabled={!!running} onClick={() => run(p.spec, p)}>
              Aja lukittu testi
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function McResultCard({ mc, run, prereg }: { mc: MCResult; run: TestRun; prereg: PreRegistration | null }) {
  const v = classify(mc.pValue, mc.params.alpha, !!prereg);
  const m = mc.params.metric;
  return (
    <div className="card section" style={{ gap: 12 }} data-testid="mc-result">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className={`pill ${VERDICT_CLASS[v.verdict]}`}>{v.title}</span>
        <span className="pill">{prereg ? 'ennalta lukittu' : 'eksploratiivinen'}</span>
      </div>
      <div style={{ fontSize: 13.5 }}>{fiNum(v.text)}</div>
      <dl className="kv">
        <dt>Testi</dt>
        <dd>
          {STATISTIC_LABELS[mc.params.statistic]} · {METRIC_LABELS[m]}
        </dd>
        <dt>Havaittu</dt>
        <dd>{fmtMetric(m, mc.observed)}</dd>
        <dt>p (Monte Carlo)</dt>
        <dd>
          {fmtPfi(mc.pValue)} · 95 % väli {fmtPfi(mc.pLow)}–{fmtPfi(mc.pHigh)}
        </dd>
        <dt>Lähempänä kuin</dt>
        <dd>{fmtPct(mc.shareGreater)} nollamalleista</dd>
        <dt>Nollamalli</dt>
        <dd>
          mediaani {fmtMetric(m, mc.nullMedian)} · 5–95 % {fmtMetric(m, mc.nullQ05)}–{fmtMetric(m, mc.nullQ95)}
        </dd>
        <dt>Osumamäärät</dt>
        <dd>
          A {fmtN(mc.params.kA)} (odotus {fmtExpected(mc.expectedA)}) · B {fmtN(mc.params.kB)} (odotus {fmtExpected(mc.expectedB)})
        </dd>
        <dt>Toisto</dt>
        <dd>
          R={fmtN(mc.params.R)}, siemen {mc.params.seed}, {mc.version}, {fmtN(mc.durationMs)} ms
        </dd>
      </dl>
      <Histogram values={mc.nullValues} observed={mc.observed} metric={m} />
      <div className="faint" style={{ fontSize: 12 }}>
        Ajo {run.id}. Sama siemen ja samat asetukset antavat täsmälleen saman jakauman.
      </div>
    </div>
  );
}

function RcResultCard({ rc }: { rc: RandomControlResult }) {
  const m = rc.params.metric;
  const vals = rc.rows.map((r) => r.value);
  return (
    <div className="card section" style={{ gap: 12 }}>
      <div className="eyebrow">Satunnaisjonokontrolli</div>
      <div style={{ fontSize: 13.5 }}>
        {rc.rows.length} siemenellistä satunnaista 0–9-jonoa (N = {fmtN(rc.params.N)}). Samat koodit haettiin jokaisesta.
        Testisuure {rc.params.statistic === 'setMin' ? 'S2' : 'S3'}: piin arvo {fmtMetric(m, rc.pi.value)}; satunnaisjonoista{' '}
        {fmtPct(rc.shareLE)} oli yhtä lähellä tai lähempänä.
      </div>
      <dl className="kv">
        <dt>Osumat A</dt>
        <dd>
          pii {fmtN(rc.pi.countA)} · satunnaisjonot ka. {fmtExpected(rc.meanCountA)} · odotus {fmtExpected(rc.expectedA)}
        </dd>
        <dt>Osumat B</dt>
        <dd>
          pii {fmtN(rc.pi.countB)} · satunnaisjonot ka. {fmtExpected(rc.meanCountB)} · odotus {fmtExpected(rc.expectedB)}
        </dd>
        <dt>Toisto</dt>
        <dd>
          siemen {rc.params.seed}, {rc.version}, {fmtN(rc.durationMs)} ms
        </dd>
      </dl>
      <Histogram values={vals} observed={rc.pi.value} metric={m} label="pii" />
    </div>
  );
}

// ------------------------------------------------------------------ loki ja monivertailu

function TestLog() {
  const runs = useApp((s) => s.runs);
  const [confirm, setConfirm] = useState(false);
  const ps = runs.map((r) => r.summary.pValue);
  const q = useMemo(() => benjaminiHochberg(ps), [runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = useMemo(() => bonferroni(ps), [runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const distinct = (f: (r: TestRun) => string) => new Set(runs.map(f)).size;
  if (!runs.length)
    return (
      <div className="section">
        <div className="eyebrow">Testiloki</div>
        <div className="muted">Ei vielä ajettuja testejä. Jokainen ajo kirjataan monivertailua varten.</div>
      </div>
    );
  return (
    <div className="section">
      <div className="eyebrow">Testiloki ja monivertailu</div>
      <div className="note warn">
        Ajettu {runs.length} testiä: {distinct((r) => `${r.spec.termA}-${r.spec.termB}`)} termiparia,{' '}
        {distinct((r) => String(r.spec.anchorN))} ankkuria, {distinct((r) => r.spec.metric)} geometriaa,{' '}
        {distinct((r) => r.spec.statistic)} testisuuretta. Jos testejä on m kappaletta, noin m·α niistä antaa p ≤ α pelkällä
        sattumalla (nyt {(runs.length * 0.05).toFixed(1).replace('.', ',')} kun α = 0,05). Raportoi kaikki, ei vain parhaita.
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Aika</th>
              <th>Testi</th>
              <th>A–B</th>
              <th className="r">Havaittu</th>
              <th className="r">p</th>
              <th className="r">q (BH)</th>
              <th className="r">Bonf.</th>
              <th>Tila</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.id}>
                <td className="mono">{fmtDateTime(r.ts)}</td>
                <td>
                  {r.kind === 'random-control' ? 'satunnaisjonot' : r.spec.statistic === 'anchorNearest' ? 'S1' : r.spec.statistic === 'setMin' ? 'S2' : 'S3'} ·{' '}
                  {r.spec.metric} · R={fmtN(r.spec.R)}
                </td>
                <td>
                  {r.spec.labelA}–{r.spec.labelB}
                </td>
                <td className="r mono">{fmtMetric(r.spec.metric, r.summary.observed)}</td>
                <td className="r mono">{fmtPfi(r.summary.pValue)}</td>
                <td className="r mono">{fmtPfi(q[i])}</td>
                <td className="r mono">{fmtPfi(b[i])}</td>
                <td>{r.preregId ? 'lukittu' : 'eksploratiivinen'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        {!confirm ? (
          <button className="btn small ghost" onClick={() => setConfirm(true)}>
            Tyhjennä loki
          </button>
        ) : (
          <>
            <span className="muted" style={{ fontSize: 13 }}>
              Tyhjennys kirjataan muutoshistoriaan.
            </span>
            <button
              className="btn small danger"
              onClick={() => {
                clearRuns();
                setConfirm(false);
              }}
            >
              Tyhjennä
            </button>
            <button className="btn small ghost" onClick={() => setConfirm(false)}>
              Peru
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sisäiset tarkistukset

function SelfChecks() {
  const digits = useApp((s) => s.digits);
  const info = useApp((s) => s.dataset.info);
  const checks = useMemo(() => {
    if (!digits || !info) return null;
    const ref = info.reference === 'pi-1m-verified' || info.reference === 'pi-prefix-1m-verified';
    const head = digits.slice(0, 1_000_000);
    const m = findAll('62884', head);
    const i = findAll('432', head);
    const mi = findAll('6464', head);
    const p = mapIndex(858511);
    return {
      ref,
      rows: [
        ['SHA-256 = referenssi', info.sha256 === PI_1M_SHA256 || info.first1MMatches === true],
        ['Alkaa 141592653589793…', digits.startsWith('141592653589793')],
        ['MATTI 62884: 9 osumaa ensimmäisessä miljoonassa', m.length === 9],
        ['MATTI ensimmäinen @48 227 ja @858 260', m[0] === 48227 && m.includes(858260)],
        ['IDA 432: 1 054 osumaa ensimmäisessä miljoonassa', i.length === 1054],
        ['IDA @858 511 ja @874 141', i.includes(858511) && i.includes(874141)],
        ['MINI 6464 @858 960', mi.includes(858960)],
        ['858 511 − 858 260 = 251', 858511 - 858260 === 251 && m.includes(858260) && i.includes(858511)],
        ['mapIndex ottaa vain n:n (N-riippumaton)', mapIndex.length === 1],
        ['|x|+|y|+|z| = 1 ankkurille', Math.abs(Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) - 1) < 1e-12],
      ] as [string, boolean][],
    };
  }, [digits, info]);
  if (!checks) return null;
  return (
    <div className="section">
      <div className="eyebrow">Sisäiset tarkistukset ladatulla aineistolla</div>
      {!checks.ref && (
        <div className="note warn">Aineisto ei ole tunnettu 1M-referenssi, joten tunnetut osumat eivät välttämättä täsmää.</div>
      )}
      <div className="card" style={{ display: 'grid', gap: 6 }}>
        {checks.rows.map(([label, ok]) => (
          <div key={label} className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
            <span style={{ color: ok ? 'var(--ok)' : 'var(--rose)', width: 16 }}>{ok ? '✓' : '✕'}</span>
            <span style={{ fontSize: 13.5 }}>{label}</span>
          </div>
        ))}
      </div>
      <div className="faint" style={{ fontSize: 12 }}>
        Samat tarkistukset ajetaan automaattisesti Vitest-testeinä (`npm test`).
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ aineisto

function DatasetSection() {
  const ds = useApp((s) => s.dataset);
  const fileRef = useRef<HTMLInputElement>(null);
  const info = ds.info;
  const refLabel: Record<string, string> = {
    'pi-1m-verified': 'Piin 1 000 000 desimaalia, tarkistussumma täsmää',
    'pi-prefix-1m-verified': 'Ensimmäinen miljoona täsmää referenssiin',
    'pi-prefix-ok': 'Alkaa piin desimaaleilla (ei tunnettua tarkistussummaa)',
    'not-pi': 'EI ala piin desimaaleilla',
    unknown: 'Tuntematon',
  };
  return (
    <div className="section">
      <div className="eyebrow">Aineisto</div>
      {info && (
        <dl className="kv card">
          <dt>Tiedosto</dt>
          <dd>
            {info.name} ({ds.source === 'bundled' ? 'mukana' : 'tuotu'})
          </dd>
          <dt>Pituus</dt>
          <dd>{fmtN(info.length)} desimaalia (1-pohjainen indeksi 1…{fmtN(info.length)})</dd>
          <dt>SHA-256</dt>
          <dd style={{ fontSize: 11 }}>{info.sha256}</dd>
          <dt>Tila</dt>
          <dd>{refLabel[info.reference]}</dd>
        </dl>
      )}
      {info?.warnings.map((w) => (
        <div key={w} className="note warn">
          {w}
        </div>
      ))}
      {ds.error && <div className="note err">{ds.error}</div>}
      <div className="row">
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importDatasetFile(f);
            e.target.value = '';
          }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Tuo numerotiedosto…
        </button>
        {ds.source === 'imported' && (
          <button className="btn ghost" onClick={() => void revertToBundled()}>
            Palauta mukana tuleva 1M
          </button>
        )}
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>
        Tiedostossa saa olla vain numeroita 0–9 (rivinvaihdot ja alun ”3.” poistetaan). Suurempi tiedosto (esim. 10M)
        toimii ilman koodimuutoksia. Kartoitus ei riipu N:stä, joten vanhat osumat pysyvät paikallaan.
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ vienti

function ExportSection() {
  const [preview, setPreview] = useState<string>('');
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} kopioitu leikepöydälle`);
    } catch {
      setPreview(text);
      toast('Kopiointi estetty: valitse teksti alta käsin');
    }
  };
  const download = (text: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <div className="section">
      <div className="eyebrow">Vienti</div>
      <div className="row">
        <button className="btn" onClick={() => copy(JSON.stringify(buildReport(), null, 2), 'Raportti (JSON)')}>
          Kopioi raportti JSON
        </button>
        <button className="btn" onClick={() => copy(hitsCsv(), 'Osumat (CSV)')}>
          Kopioi osumat CSV
        </button>
        {!IS_ARTIFACT && (
          <>
            <button className="btn ghost" onClick={() => download(JSON.stringify(buildReport(), null, 2), `pi-atlas-raportti-${stamp}.json`, 'application/json')}>
              Lataa JSON
            </button>
            <button className="btn ghost" onClick={() => download(hitsCsv(), `pi-atlas-osumat-${stamp}.csv`, 'text/csv')}>
              Lataa CSV
            </button>
          </>
        )}
        <button className="btn ghost" onClick={() => setPreview(JSON.stringify(buildReport(), null, 2))}>
          Näytä raportti
        </button>
      </div>
      {preview && <textarea className="input mono" readOnly value={preview} style={{ minHeight: 220, fontSize: 12 }} onFocus={(e) => e.target.select()} />}
      <AuditLog />
    </div>
  );
}

function AuditLog() {
  const audit = useApp((s) => s.audit);
  const [all, setAll] = useState(false);
  if (!audit.length) return null;
  const rows = all ? [...audit].reverse() : [...audit].reverse().slice(0, 8);
  return (
    <div className="section" style={{ gap: 6 }}>
      <div className="eyebrow">Muutoshistoria</div>
      <div className="card" style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
        {rows.map((a, i) => (
          <div key={i}>
            <span className="mono faint">{fmtDateTime(a.ts)}</span> <span className="pill">{a.type}</span> {a.text}
          </div>
        ))}
      </div>
      {audit.length > 8 && (
        <button className="btn small ghost" onClick={() => setAll(!all)}>
          {all ? 'Näytä vähemmän' : `Näytä kaikki (${audit.length})`}
        </button>
      )}
    </div>
  );
}

function FormulaSection() {
  const engineMode = useApp((s) => s.engineMode);
  return (
    <div className="section">
      <div className="eyebrow">Kaavat ja versiot</div>
      <div className="eq">{FORMULA_TEXT}</div>
      <div className="eq">{LEGACY_FORMULA_TEXT}</div>
      <dl className="kv">
        <dt>Kartoitus</dt>
        <dd>{FORMULA_VERSION}</dd>
        <dt>Koodaukset</dt>
        <dd>{ENCODING_VERSION}</dd>
        <dt>Tilastot</dt>
        <dd>{STATS_VERSION}</dd>
        <dt>Avattu verkko</dt>
        <dd>{NET_VERSION}</dd>
        <dt>Laskenta</dt>
        <dd>{engineMode === 'worker' ? 'Web Worker' : engineMode === 'inline' ? 'pääsäie' : 'käynnistyy'}</dd>
      </dl>
      <div className="faint" style={{ fontSize: 12.5 }}>
        Kartoitus on käyttäjän kanssa valittu kultaisen kulman ja irrationaalisen askelluksen sijoitus oktaedrille. Se ei
        väitä, että pii olisi itsessään oktaedrin muotoinen. Etäisyys 3D:ssä on suora (chord), ei pintaa pitkin kulkeva
        lyhin reitti.
      </div>
    </div>
  );
}
