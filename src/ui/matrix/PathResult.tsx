// Polkuhaun tulos: tila ja syyt, kolmen osan erottelu (laskettu piin rakenne / käyttäjän symbolinen tulkinta /
// testattu ennustetulos), reittikartta, askelten jäljitys, satunnaisvertailu ja Path Score, sanasto sekä tallennus.
// Puuttuvia reitin vaiheita ei koskaan täydennetä tekstillä: jos reittiä ei löydy, se sanotaan ja syyt luetellaan.
import { useState } from 'react';
import { DOMAIN_LABELS } from '../../core/matrix/types';
import { PATH_RULES } from '../../core/path/rules';
import { fmtCost, PATHSCORE_DEFINITION, PATHSCORE_DISCLAIMER } from '../../core/path/score';
import type { PathRoute, PathScore, PathStep, SearchOutcome } from '../../core/path/types';
import { seedFrom } from '../../core/random';
import { setMatrixSub } from '../../state/matrix-actions';
import {
  EXPLORATORY_LABEL,
  exploreVerdict,
  latestBlindFor,
  NULL_R_OPTIONS,
  NULL_S_OPTIONS,
  nullConfigKey,
  PathCurrent,
} from '../../state/path';
import { openPathNode, runPathNullComparison, savePathResult, setNullForm, showPathRoute } from '../../state/path-actions';
import { useApp } from '../../state/store';
import { fiNum, fmtDateTime, fmtN, fmtPfi, fmtSigned } from '../format';
import { LayerBadge, RealmBadge } from './bits';
import { fmtFi, JobProgress, ROLE_TITLE } from './path-bits';
import { PathMap } from './PathMap';

const MODE_TITLE: Record<SearchOutcome['mode'], string> = {
  kaksisuuntainen: 'kaksisuuntainen',
  '234': '234 · lähdöstä eteenpäin',
  '432': '432 · tavoitteesta taaksepäin',
};

const MODEL_TITLE = { tasajakauma: 'Tasajakauma (osumamäärät säilyvät, paikat arvotaan)', satunnaisjono: 'Satunnaiset 0–9-jonot' } as const;
const MODEL_SHORT = { tasajakauma: 'Tasajakauma', satunnaisjono: 'Satunnaisjonot' } as const;

const nodeName = (n: { labels: string[]; code: string }) => n.labels.join(' / ') || n.code;

export function PathResultView() {
  const cur = useApp((s) => s.matrix.path.current);
  if (!cur)
    return (
      <div className="muted mx-small" data-testid="path-no-result">
        Ei vielä tulosta. Lisää lähtö- ja tavoitetunnisteet ja aja haku. Parametrit lukitaan (SHA-256) ennen kuin tulos näytetään.
      </div>
    );
  return <Result cur={cur} />;
}

function Result({ cur }: { cur: PathCurrent }) {
  const o = cur.outcome;
  const found = o.status === 'löytyi';
  return (
    <section className="card section pd-result" data-testid="path-result" aria-label="Polkuhaun tulos" style={{ gap: 14 }}>
      <div className="pd-result-head">
        <span className={`pill ${found ? 'coded' : o.status === 'virhe' ? 'user' : 'exp'}`}>
          {found ? 'Reitti löytyi' : o.status === 'virhe' ? 'Haku epäonnistui' : 'Reittiä ei löytynyt'}
        </span>
        <span className="pill">{MODE_TITLE[o.mode]}</span>
        {cur.params.use369 && <span className="pill stat">369-avain</span>}
        {cur.source === 'tallennettu' && <span className="pill geo">tallennettu tulos</span>}
        {cur.exploratory ? (
          <span className="pill exp" data-testid="path-exploratory">
            {EXPLORATORY_LABEL}
          </span>
        ) : (
          <span className="pill" data-testid="path-exploratory">
            parametrit lukittu ennen tuloksia
          </span>
        )}
      </div>
      <div className="pd-status" data-testid="path-status">
        {found
          ? `Reittiehdokkaita ${o.routes.length}; paras ${fmtCost(o.routes[0]?.cost ?? null)}.`
          : o.status === 'virhe'
            ? 'Hakua ei voitu suorittaa. Syyt alla.'
            : 'Reittiä ei löytynyt näillä tunnisteilla, säännöillä ja parametreilla. Syyt alla; puuttuvia vaiheita ei täydennetä.'}{' '}
        <span className="faint">
          {o.sourceLabel} · {cur.source === 'tallennettu' ? `tallennettu ajo ${fmtDateTime(cur.ts)}` : `${fiMs(o.ms)} ms`}
        </span>
      </div>
      <div className="mx-small faint pd-lockline" data-testid="path-run-hash">
        SHA-256 (lukittu ennen ajoa {fmtDateTime(cur.ts)}): <span className="mono">{cur.hash.slice(0, 24)}…</span>
        {cur.hashMatches === true && ' · moottorin kanoninen kysely täsmää ✓'}
        {cur.hashMatches === false && ' · ✗ moottorin kanoninen kysely erosi lukitusta'} · tulostiiviste{' '}
        <span className="mono">{o.resultFingerprint}</span>
      </div>
      {cur.exploratory && cur.exploratoryReason && <div className="note warn mx-small">{cur.exploratoryReason}</div>}
      <Reasons o={o} />
      <Separation cur={cur} />
      {found && (
        <section className="section" aria-label="Reittikartta" style={{ gap: 6 }}>
          <div className="eyebrow">Reittikartta</div>
          <PathMap routes={o.routes} />
        </section>
      )}
      {found && <Trace routes={o.routes} />}
      <Compare cur={cur} />
      <Vocabulary o={o} />
      {o.mode !== 'kaksisuuntainen' && <Reached o={o} />}
      <SaveBox cur={cur} />
    </section>
  );
}

const fiMs = (ms: number) => String(ms).replace('.', ',');

// ------------------------------------------------------------------ syyt

function Reasons({ o }: { o: SearchOutcome }) {
  const notFound = o.status !== 'löytyi';
  if (!notFound && !o.reasons.length && !o.failures.length) return null;
  return (
    <section className={`pd-reasons${notFound ? ' miss' : ''}`} data-testid="path-reasons" aria-label="Syyt ja epäonnistumiset">
      <div className="eyebrow amber">{notFound ? 'Miksi reittiä ei löytynyt' : 'Huomautukset hausta'}</div>
      {o.reasons.length > 0 && (
        <ul className="pd-list">
          {o.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {o.failures.length > 0 && (
        <>
          <div className="mx-small faint">Hylätyt tunnisteet ja koodit:</div>
          <ul className="pd-list bad">
            {o.failures.map((f, i) => (
              <li key={i}>
                {f.label ? <b>{f.label}</b> : null}
                {f.code ? <span className="mono"> {f.code}</span> : null}: {f.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      {notFound && !o.reasons.length && !o.failures.length && <div className="mx-small faint">Syitä ei kirjattu.</div>}
    </section>
  );
}

// ------------------------------------------------------------------ kolme osaa

function Separation({ cur }: { cur: PathCurrent }) {
  const blindRuns = useApp((s) => s.matrix.path.blindRuns);
  const blind = latestBlindFor(blindRuns, cur.params);
  const o = cur.outcome;
  return (
    <section className="pd-sep" data-testid="path-separation" aria-label="Kolme osaa erillään">
      <div className="pd-sep-part pi" data-testid="path-sep-computed">
        <div className="pd-sep-title">
          <span>Laskettu piin rakenne</span> <RealmBadge realm="pi" />
        </div>
        {o.routes.length ? (
          <ul className="pd-list">
            {o.routes.map((r, i) => {
              const ok = r.steps.every((s) => s.verified === true);
              const rules = [...new Set(r.steps.map((s) => s.rule))].join(', ');
              return (
                <li key={r.key}>
                  <b>Reitti {i + 1}:</b> <span className="mono">{r.nodes.map((n) => `${n.code}@${fmtN(n.n)}`).join(' → ')}</span> ·{' '}
                  {fmtCost(r.cost)} · säännöt {rules || '–'} ·{' '}
                  <span className={ok ? 'mx-ok' : 'mx-bad'}>{ok ? '✓ jokainen askel tarkistettu lähdeaineistosta' : '✗ tarkistus ei täsmää'}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mx-small">
            Reittiä ei löytynyt ({o.status}). Syitä {o.reasons.length}, hylättyjä tunnisteita {o.failures.length} (ks. yllä).
          </div>
        )}
        {cur.scores.length > 0 && (
          <div className="mx-small">
            Path Score: {cur.scores.map((s, i) => `reitti ${i + 1} ${s.total == null ? 'ei pistemäärää' : `${s.total} / 100`}`).join(' · ')}
            <div className="faint pd-disclaimer">{PATHSCORE_DISCLAIMER}</div>
          </div>
        )}
        <div className="mx-small faint">
          Sanasto: {o.vocabulary.map((v) => `${v.code} (${fmtN(v.hits)} os.)`).join(', ') || '–'} · tulostiiviste {o.resultFingerprint}
        </div>
      </div>
      <div className="pd-sep-part sym" data-testid="path-sep-symbolic">
        <div className="pd-sep-title">
          <span>Käyttäjän symbolinen tulkinta</span> <RealmBadge realm="tarina" />
        </div>
        <dl className="kv pd-kv">
          <dt>Lähtötila</dt>
          <dd className="mx-dd-text">{cur.query.startText.trim() || '–'}</dd>
          <dt>Tavoitetila</dt>
          <dd className="mx-dd-text">{cur.query.goalText.trim() || '–'}</dd>
          <dt>Tunnisteet</dt>
          <dd className="mx-dd-text">
            {cur.query.identifiers.length
              ? cur.query.identifiers.map((i) => `${ROLE_TITLE[i.role]}: ${i.label || i.value} (${i.kind}, ${i.origin})`).join(' · ')
              : '–'}
          </dd>
          {cur.query.timeRange && (
            <>
              <dt>Aikarajaus</dt>
              <dd>
                {cur.query.timeRange.from ?? '…'} – {cur.query.timeRange.to ?? '…'}
              </dd>
            </>
          )}
        </dl>
        <div className="mx-small faint">
          Tekstit ja nimien merkitykset ovat käyttäjän tulkintaa. Ne eivät vaikuta hakuun muuten kuin hyväksyttyjen tunnisteiden koodien
          kautta, eivätkä tarinan suhteet ole hakusärmiä.
        </div>
      </div>
      <div className="pd-sep-part test" data-testid="path-tested">
        <div className="pd-sep-title">
          <span>Testattu ennustetulos</span>
        </div>
        {blind && blind.summary ? (
          <>
            <div className="mx-small">
              <b>
                Sokkotesti {fmtDateTime(blind.ts)}: oikein {blind.summary.hitsAt1}/{blind.summary.folds}
              </b>{' '}
              (sattuman odotus {fmtFi(blind.summary.expectedHitsAt1)}), p = {fmtPfi(blind.summary.pVsRandom)} satunnaista valintaa vastaan ·{' '}
              <span className="mono">SHA-256 {blind.hash.slice(0, 12)}…</span>
              {blind.exploratory ? ` · ${EXPLORATORY_LABEL}` : ''}
            </div>
            <div className="mx-small">{fiNum(blind.summary.verdict)}</div>
            <div className="mx-small faint">
              Sokkotesti samoilla polkuhaun parametreilla ({blind.params.kind}). Tulos koskee menetelmää, ei tätä yksittäistä reittiä.
            </div>
          </>
        ) : (
          <>
            <div className="mx-small">
              <b>Ei testattu.</b> Näillä polkuhaun parametreilla ei ole ajettu sokkotestiä. Ilman sokkotestiä mikään löydetty reitti ei ole
              ennuste.
            </div>
            <button type="button" className="mx-btn" data-testid="path-open-blind" onClick={() => setMatrixSub('sokkotesti')}>
              Avaa Sokkotesti
            </button>
          </>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ jäljitys

function Trace({ routes }: { routes: PathRoute[] }) {
  return (
    <section className="section" data-testid="path-trace" aria-label="Reittien jäljitys" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="eyebrow">Jäljitys askel askeleelta</span>
        <RealmBadge realm="pi" />
      </div>
      {routes.map((r, i) => (
        <article key={r.key} className="pd-route" data-testid="path-route" data-route={i + 1}>
          <div className="pd-route-head">
            <b>Reitti {i + 1}</b>
            <span className="mx-small">{fmtCost(r.cost)}</span>
            {r.meetIndex != null && <span className="mx-chip gold">kohtaaminen solmussa {r.meetIndex + 1}</span>}
          </div>
          <div className="mx-btn-row">
            <button type="button" className="mx-btn" data-testid="path-show-spiral" onClick={() => showPathRoute(i, 'spiraali')}>
              Näytä spiraalissa
            </button>
            <button type="button" className="mx-btn" data-testid="path-show-3d" onClick={() => showPathRoute(i, '3d')}>
              Näytä 3D:ssä
            </button>
          </div>
          <div className="pd-nodes" role="group" aria-label={`Reitin ${i + 1} solmut`}>
            {r.nodes.map((n, j) => (
              <button
                key={`${n.code}@${n.n}`}
                type="button"
                className="mx-btn pd-node-btn"
                data-testid="path-open-node"
                title="Avaa osuma matriisissa (juuri → koodi → osuma)"
                onClick={() => openPathNode(n.code, n.n, nodeName(n))}
              >
                <span className="faint">{j + 1}.</span> {nodeName(n)} <span className="mono">{n.code}@{fmtN(n.n)}</span>
                <span className="pd-node-act">Avaa matriisissa</span>
              </button>
            ))}
          </div>
          <ol className="pd-steps">
            {r.steps.map((st, j) => (
              <StepCard key={j} st={st} index={j} />
            ))}
          </ol>
        </article>
      ))}
    </section>
  );
}

function verifiedChip(v: boolean | null) {
  if (v === true) return <span className="mx-chip ok">✓ tarkistettu</span>;
  if (v === false) return <span className="mx-chip bad">✗ ei täsmää</span>;
  return <span className="mx-chip">ei numeroita (nollamalli)</span>;
}

function StepCard({ st, index }: { st: PathStep; index: number }) {
  const def = PATH_RULES[st.rule];
  return (
    <li className={`pd-step l-${st.layer}${st.transform ? ' t369' : ''}`} data-testid="path-step">
      <div className="pd-step-line">
        <span className="pd-step-no">{index + 1}.</span>
        <span>
          <b>{nodeName(st.from)}</b> <span className="mono">{st.from.code} @{fmtN(st.from.n)}</span> →{' '}
          <b>{nodeName(st.to)}</b> <span className="mono">{st.to.code} @{fmtN(st.to.n)}</span>
        </span>
      </div>
      <div className="pd-digits mono">
        π[{fmtN(st.from.n)}…] = {st.digitsFrom ?? '–'} {st.digitsFrom === st.from.code ? '✓' : st.digitsFrom == null ? '' : '✗'} · π[{fmtN(st.to.n)}…] ={' '}
        {st.digitsTo ?? '–'} {st.digitsTo === st.to.code ? '✓' : st.digitsTo == null ? '' : '✗'}
      </div>
      <div className="mx-chips">
        <span className="mx-chip">{def.title}</span>
        <LayerBadge layer={st.layer} />
        <span className="mx-chip dir">{DOMAIN_LABELS[st.domain]}</span>
        <span className={`mx-chip dir pd-side-chip s-${st.side}`}>{st.side === '234' ? '234 · lähtöpuoli' : '432 · tavoitepuoli'}</span>
        {st.transform && <span className="mx-chip op">369-muunnos</span>}
        {verifiedChip(st.verified)}
      </div>
      <div className="pd-formula mono" data-testid="path-step-formula">
        {st.formula}
      </div>
      <div className="mx-small faint">
        Sääntö: {def.formula}
      </div>
      <div className="mx-small">
        Δn = {fmtSigned(st.delta)} · haarautuminen {fmtN(st.branching)} naapuria
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ satunnaisvertailu ja Path Score

function Compare({ cur }: { cur: PathCurrent }) {
  const nf = useApp((s) => s.matrix.path.nullForm);
  const running = useApp((s) => s.matrix.path.running);
  const index = useApp((s) => s.matrix.path.index.nulls);
  const seed = seedFrom(nf.seedText);
  const preview = exploreVerdict(index, cur.hash, nullConfigKey({ R: nf.R, S: nf.randomStrings, seed }), 'Saman haun satunnaisvertailu');
  const nul = cur.null;
  return (
    <section className="section pd-compare" data-testid="path-compare" aria-label="Satunnaisvertailu ja Path Score" style={{ gap: 10 }}>
      <div className="eyebrow">Satunnaisvertailu ja Path Score</div>
      <div className="mx-small muted">
        Sama haku samoilla lukituilla parametreilla ajetaan satunnaisaineistossa: tasajakauma (jokaisen koodin osumamäärä säilyy,
        paikat arvotaan) ja siemenelliset satunnaiset 0–9-jonot. p = (1 + yhtä hyvät tai paremmat) / (R + 1).
      </div>
      <div className="mx-form-grid">
        <label className="field">
          <span>REPLIKAATIT R</span>
          <select className="input" id="path-null-r" value={nf.R} onChange={(e) => setNullForm({ R: Number(e.target.value) })}>
            {NULL_R_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {fmtN(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>SATUNNAISJONOT</span>
          <select className="input" id="path-null-strings" value={nf.randomStrings} onChange={(e) => setNullForm({ randomStrings: Number(e.target.value) })}>
            {NULL_S_OPTIONS.map((x) => (
              <option key={x} value={x}>
                {x} jonoa
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>SIEMEN</span>
          <input className="input mono" id="path-null-seed" value={nf.seedText} onChange={(e) => setNullForm({ seedText: e.target.value })} />
        </label>
      </div>
      <div className="mx-small faint">
        Siemen ”{nf.seedText}” = {seed}. {preview.exploratory ? preview.reason : 'Vertailun asetukset lukitaan (SHA-256) ennen ajoa.'}
      </div>
      <button type="button" className="mx-btn primary" data-testid="path-null-run" disabled={!!running} onClick={() => void runPathNullComparison()}>
        {running?.kind === 'vertailu' ? 'Satunnaisvertailu käynnissä…' : 'Aja satunnaisvertailu'}
      </button>
      <JobProgress kinds={['vertailu']} testId="path-null-running" />
      {nul && (
        <div className="section" style={{ gap: 8 }} data-testid="path-null-result">
          {nul.exploratory && <div className="note warn mx-small">{nul.exploratoryReason ?? EXPLORATORY_LABEL}</div>}
          {/* Mallit rinnakkain yhdessä taulukossa: p näkyy toisena sarakkeena kapeallakin näytöllä. */}
          {nul.nulls.length ? (
            <div className="table-wrap" data-testid="path-null-table">
              <table className="data">
                <thead>
                  <tr>
                    <th>Nollamalli</th>
                    <th className="r">p</th>
                    <th className="r">Yhtä hyvä tai parempi</th>
                    <th className="r">Ei reittiä</th>
                    <th>95 % väli (Wilson)</th>
                    <th className="r">Siemenet alkaen</th>
                  </tr>
                </thead>
                <tbody>
                  {nul.nulls.map((n) => (
                    <tr key={n.model} data-testid="path-null-model" data-model={n.model} title={MODEL_TITLE[n.model]}>
                      <td>{MODEL_SHORT[n.model]}</td>
                      <td className="r mono">
                        <b>{fmtPfi(n.pValue)}</b>
                      </td>
                      <td className="r mono">
                        {fmtN(n.countAsGood)} / {fmtN(n.replicates)}
                      </td>
                      <td className="r mono">{fmtN(n.noRoute)}</td>
                      <td className="mono">
                        {fmtPfi(n.pLow)}–{fmtPfi(n.pHigh)}
                      </td>
                      <td className="r mono">{n.seed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mx-small faint">Yhtään nollamallia ei ajettu (R = 0 ja jonot 0).</div>
          )}
          <div className="mx-small faint">
            {MODEL_TITLE.tasajakauma}. {MODEL_TITLE.satunnaisjono}, pituus N. p = (1 + yhtä hyvät tai paremmat) / (replikaatit + 1).
          </div>
          <div className={`mx-small ${nul.reproducible ? '' : 'mx-bad'}`} data-testid="path-repro">
            Toistettavuus: {nul.reproducible ? 'kyllä ✓ (sama tulostiiviste kahdella erillisellä ajolla)' : 'ei ✗ — kokonaispistemäärää ei anneta'} ·
            SHA-256 <span className="mono">{nul.hash ? `${nul.hash.slice(0, 12)}…` : '–'}</span>
          </div>
          <details className="pd-details" data-testid="path-null-notes">
            <summary>Siemenet ja toistettavuuden tarkistus ({nul.notes.length})</summary>
            <ul className="pd-list faint">
              {nul.notes.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {cur.outcome.routes.length ? (
        <div className="pd-scores">
          {cur.scores.map((s, i) => (
            <ScoreCard key={i} s={s} index={i} />
          ))}
        </div>
      ) : (
        <div className="mx-small faint">
          Reittiä ei löytynyt, joten Path Scorea ei ole. Satunnaisvertailu kertoo silti, kuinka usein satunnaisaineistosta löytyy reitti
          (havaittu = ei reittiä, joten p = 1).
        </div>
      )}
      <details className="pd-details">
        <summary>Path Scoren määritelmä</summary>
        <div className="mx-small faint">{PATHSCORE_DEFINITION}</div>
      </details>
    </section>
  );
}

function ScoreCard({ s, index }: { s: PathScore; index: number }) {
  const rep = s.reproducible === true ? 'kyllä' : s.reproducible === false ? 'ei' : 'ei tarkistettu';
  // Harvinaisuus yhdistää mallit varovaisesti: suurin p ja suurin replikaattimäärä (score.ts: pathScore).
  const ran = s.nulls.filter((n) => n.replicates >= 1);
  const pMax = ran.length ? Math.max(...ran.map((n) => n.pValue)) : null;
  const rMax = ran.length ? Math.max(...ran.map((n) => n.replicates)) : null;
  return (
    <div className="pd-score" data-testid="path-score" data-route={index + 1}>
      <div className="pd-score-head">
        <span>Reitti {index + 1} · Path Score</span>
        <b className="pd-score-total" data-testid="path-score-total">
          {s.total == null ? 'ei pistemäärää' : `${s.total} / 100`}
        </b>
      </div>
      {/* Vastuuvapauslauseke heti pistemäärän vieressä: Path Score ei ole todennäköisyys. */}
      <div className="pd-disclaimer mx-small" data-testid="path-score-disclaimer">
        {s.disclaimer || PATHSCORE_DISCLAIMER}
      </div>
      <dl className="kv pd-kv">
        <dt>Harvinaisuus</dt>
        <dd>
          {s.rarity == null || pMax == null || rMax == null
            ? 'ei satunnaisvertailua'
            : `${fmtFi(s.rarity)} (p = ${fmtPfi(pMax)}, R = ${fmtN(rMax)}: suurin p ja suurin R)`}
        </dd>
        <dt>Pituus</dt>
        <dd>{fmtFi(s.length)}</dd>
        <dt>Haarautuminen</dt>
        <dd>{fmtFi(s.branching)}</dd>
        <dt>Muunnokset</dt>
        <dd>{fmtFi(s.transforms)}</dd>
        <dt>Rakenne</dt>
        <dd>
          geometrinen {Math.round(s.structure.geometric * 100)} %, matemaattinen {Math.round(s.structure.numeric * 100)} % (ei pisteytetä)
        </dd>
        <dt>Toistettava</dt>
        <dd>{rep}</dd>
      </dl>
      {s.total == null && (
        <div className="mx-small faint">
          Kokonaispistemäärää ei anneta ilman satunnaisvertailua ja todettua toistettavuutta.
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ sanasto ja saavutetut solmut

function Vocabulary({ o }: { o: SearchOutcome }) {
  if (!o.vocabulary.length) return null;
  return (
    <section className="section" aria-label="Sanasto" style={{ gap: 6 }}>
      <div className="eyebrow">Sanasto (solmuina käytetyt koodit)</div>
      <div className="table-wrap" data-testid="path-vocab">
        <table className="data">
          <thead>
            <tr>
              <th>Koodi</th>
              <th>Nimet</th>
              <th>Roolit</th>
              <th className="r">Osumia</th>
              <th>Käytössä</th>
            </tr>
          </thead>
          <tbody>
            {o.vocabulary.map((v) => (
              <tr key={v.code}>
                <td className="mono">{v.code}</td>
                <td>{v.labels.join(', ')}</td>
                <td>{v.roles.join(', ')}</td>
                <td className="r mono">{fmtN(v.hits)}</td>
                <td className="pd-wrap-cell">{v.used ? '✓ solmuina' : `✗ ${v.note ?? ''}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Reached({ o }: { o: SearchOutcome }) {
  const side = o.mode === '234' ? o.forward : o.backward;
  const rows = o.reachedSample;
  const byDepth = new Map<number, number>();
  for (const r of rows) byDepth.set(r.depth, (byDepth.get(r.depth) ?? 0) + 1);
  return (
    <section className="section" data-testid="path-reached" aria-label="Saavutetut solmut" style={{ gap: 6 }}>
      <div className="eyebrow">
        Saavutetut solmut ({o.mode === '234' ? 'lähtöpuoli 234' : 'tavoitepuoli 432'})
      </div>
      <div className="mx-small">
        {side
          ? `${fmtN(side.reached)} solmua, ${fmtN(side.expanded)} laajennusta, syvin ${side.maxDepthReached} askelta${side.budgetHit ? ', budjetti loppui' : ''}.`
          : 'Hakupuolen tilastoa ei ole (tallennettu tulos).'}{' '}
        {rows.length > 0 && `Näyte ${rows.length} solmua: ${[...byDepth].sort((a, b) => a[0] - b[0]).map(([d, k]) => `syvyys ${d}: ${k}`).join(', ')}.`}
      </div>
      {rows.length > 0 && (
        <div className="table-wrap pd-reached-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="r">Syv.</th>
                <th>Solmu</th>
                <th className="r">n</th>
                <th>Sääntö</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((r) => (
                <tr key={`${r.node.code}@${r.node.n}`}>
                  <td className="r mono">{r.depth}</td>
                  <td>
                    {nodeName(r.node)} <span className="mono">{r.node.code}</span>
                  </td>
                  <td className="r mono">{fmtN(r.node.n)}</td>
                  <td>{r.via ?? 'lähde'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ tallennus

function SaveBox({ cur }: { cur: PathCurrent }) {
  const [title, setTitle] = useState('');
  return (
    <section className="section pd-save" aria-label="Tallenna tulos" style={{ gap: 8 }}>
      <div className="eyebrow">Tallenna tulos</div>
      <div className="mx-small faint">
        Tallentaa kyselyn tekstit ja tunnisteet, parametrit, tiivisteen, reitit askelineen, Path Scoret, satunnaisvertailut ja
        viittauksen uusimpaan sokkotestiin samoilla parametreilla. Tiedot pysyvät tällä laitteella.
      </div>
      <div className="mx-btn-row">
        <input
          className="input"
          style={{ flex: '1 1 160px', width: 'auto' }}
          id="path-save-title"
          aria-label="Tallennettavan tuloksen nimi"
          placeholder="nimi (valinnainen)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="button"
          className="mx-btn"
          data-testid="path-save"
          onClick={() => {
            if (savePathResult(title)) setTitle('');
          }}
        >
          Tallenna tulos
        </button>
      </div>
      {cur.source === 'tallennettu' && <div className="mx-small faint">Tämä on avattu tallennettu tulos.</div>}
    </section>
  );
}
