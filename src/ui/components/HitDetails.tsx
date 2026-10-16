import { useMemo } from 'react';
import { digitsAt, sliceContext } from '../../core/digits';
import { ENCODING_LABELS, t9Ambiguity, t9Readings } from '../../core/encodings';
import { FIB, fibIndexOf, nearestFib } from '../../core/fibonacci';
import {
  barycentric,
  chordDistance,
  faceBits,
  faceName,
  faceRelation,
  indexDiffStructure,
  mapIndex,
  toP5,
  vogel,
} from '../../core/mapping';
import { nearestIndex } from '../../core/search';
import { eventTimestamp, hitKey, termEncoding } from '../../core/types';
import { select, setAnchor, setNote, setTab, toggleEventLink } from '../../state/actions';
import { store, useApp } from '../../state/store';
import { fmtD, fmtDate, fmtDec, fmtExpected, fmtN, fmtSigned } from '../format';

const REL_TEXT: Record<string, string> = {
  sama: 'sama pinta kuin ankkurilla',
  reunanaapuri: 'viereinen pinta (yhteinen särmä)',
  kärkinaapuri: 'pinnoilla yhteinen kärki',
  vastakkainen: 'vastakkainen pinta',
};

/** Lyhyt 1D-leike, jossa koodin numerot korostettu. */
export function MiniContext({ n, len, step, color }: { n: number; len: number; step: number; color: string }) {
  const digits = useApp((s) => s.digits);
  const span = (len - 1) * step + 1;
  const ctx = sliceContext(digits, n, span, 10, 10);
  const marks = new Set<number>();
  for (let i = 0; i < len; i++) marks.add(n + i * step);
  return (
    <div className="mono" style={{ fontSize: 15, overflowX: 'auto', whiteSpace: 'nowrap' }} aria-label="Numerot osuman ympäriltä">
      {ctx.atStart ? <span className="faint">[alku] </span> : <span className="faint">… </span>}
      {Array.from(ctx.text).map((d, i) => {
        const idx = ctx.start + i;
        const on = marks.has(idx);
        return (
          <span
            key={idx}
            style={
              on
                ? { background: color, color: 'var(--ink-on-accent)', borderRadius: 3, padding: '1px 1px', fontWeight: 600 }
                : { color: 'var(--fg-2)' }
            }
          >
            {d}
          </span>
        );
      })}
      {ctx.atEnd ? <span style={{ color: 'var(--amber)' }}> [aineiston loppu]</span> : <span className="faint"> …</span>}
    </div>
  );
}

export function HitDetails({ termId, n, compact = false }: { termId: string; n: number; compact?: boolean }) {
  const term = useApp((s) => s.terms.find((t) => t.id === termId));
  const h = useApp((s) => s.hits[termId]);
  const anchor = useApp((s) => s.anchor);
  const digits = useApp((s) => s.digits);
  const notes = useApp((s) => s.notes);
  const events = useApp((s) => s.events);
  const runs = useApp((s) => s.runs);
  const anchorTerm = useApp((s) => s.terms.find((t) => t.id === s.anchor.termId));

  const info = useMemo(() => {
    if (!term || !h) return null;
    const enc = termEncoding(term);
    const step = term.mode === 'fibSkip' ? FIB[term.fibK ?? 10] : 1;
    const p = mapIndex(n);
    const ap = mapIndex(anchor.n);
    const d1 = n - anchor.n;
    const i = nearestIndex(h.hits, n);
    const prev = i > 0 ? h.hits[i - 1] : null;
    const next = i >= 0 && i < h.hits.length - 1 ? h.hits[i + 1] : null;
    const actual =
      term.mode === 'fibSkip'
        ? Array.from({ length: enc.code.length }, (_, k) => digits[n - 1 + k * step]).join('')
        : digitsAt(digits, n, enc.code.length);
    return {
      enc,
      step,
      p,
      face: faceBits(p),
      bary: barycentric(p),
      v2: vogel(n),
      d1,
      d3: chordDistance(p, ap),
      rel: faceRelation(faceBits(p), faceBits(ap)),
      nf: nearestFib(Math.abs(d1)),
      fk: fibIndexOf(Math.abs(d1)),
      struct: indexDiffStructure(Math.abs(d1)),
      prev,
      next,
      actual,
      verified: actual === h.code,
    };
  }, [term, h, n, anchor.n, digits]);

  if (!term || !h || !info) return <div className="muted">Osumaa ei löydy.</div>;
  const key = hitKey({ termId, n });
  const isAnchor = anchor.termId === termId && anchor.n === n;
  const linked = events.filter((e) => e.linkedHits.includes(key));
  const ts = linked.length ? eventTimestamp(linked[0]) : null;
  const p5 = toP5(n, ts);
  const tested = runs.some(
    (r) => (r.spec.termA === termId || r.spec.termB === termId) && (r.spec.termA === anchor.termId || r.spec.termB === anchor.termId),
  );

  return (
    <div className="section" style={{ gap: 14 }}>
      <div className="row">
        {term.mode === 'fibSkip' ? (
          <span className="pill exp">Kokeellinen hyppypolku (ei peräkkäinen)</span>
        ) : (
          <span className="pill coded">Koodattu osuma</span>
        )}
        {!isAnchor && <span className="pill geo">Geometrinen yhteys: {REL_TEXT[info.rel]}</span>}
        {tested && <span className="pill stat">Tilastollisesti arvioitu</span>}
        {notes[key] && <span className="pill user">Oma tulkinta</span>}
      </div>

      <div className="card flat" style={{ padding: 12 }}>
        <MiniContext n={n} len={info.enc.code.length} step={info.step} color={term.color} />
        <div className={`verify ${info.verified ? '' : 'bad'}`} style={{ marginTop: 10 }}>
          <span className="mark">{info.verified ? '✓' : '✕'}</span>
          <span>
            {term.mode === 'fibSkip' ? (
              <>
                Desimaalit n = {fmtN(n)}, +{fmtN(info.step)}, … ovat <b className="mono">{info.actual}</b>. Polku hyppii F
                <sub>{term.fibK}</sub> = {fmtN(info.step)} numeron välein; se ei ole piin peräkkäinen merkkijono.
              </>
            ) : (
              <>
                Lähdeaineiston desimaalit {fmtN(n)}–{fmtN(n + info.enc.code.length - 1)} ovat{' '}
                <b className="mono">{info.actual}</b> {info.verified ? '= haettu koodi' : '≠ haettu koodi'}.
              </>
            )}
          </span>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn small" onClick={() => setTab('digits')}>
            Avaa numerolinja
          </button>
          <button className="btn small" onClick={() => setTab('space')}>
            3D
          </button>
          <button className="btn small" onClick={() => setTab('map')}>
            Kartta
          </button>
          {!isAnchor && (
            <button className="btn small ghost" onClick={() => setAnchor({ termId, n })}>
              Aseta ankkuriksi
            </button>
          )}
        </div>
      </div>

      <dl className="kv">
        <dt>Koodaus</dt>
        <dd>
          {ENCODING_LABELS[term.encoding]} · {h.code}
        </dd>
        <dt>Lukutapa</dt>
        <dd>{info.enc.steps.map((s) => `${s.ch}→${s.out}`).join(' ') || info.enc.rule}</dd>
        <dt>Osumia</dt>
        <dd>
          {fmtN(h.count)} (odotus satunnaisjonossa {fmtExpected(h.expected)})
        </dd>
        {term.encoding === 'T9' && (
          <>
            <dt>T9-monitulkinta</dt>
            <dd>
              {fmtN(t9Ambiguity(h.code))} kirjainjonoa, esim. {t9Readings(h.code, 5).join(', ')}
            </dd>
          </>
        )}
      </dl>

      {!compact && (
        <>
          <div className="eyebrow">Geometria</div>
          <dl className="kv">
            <dt>Pinta</dt>
            <dd>{faceName(info.face)}</dd>
            <dt>XYZ</dt>
            <dd>
              {fmtD(info.p.x, 5)}, {fmtD(info.p.y, 5)}, {fmtD(info.p.z, 5)}
            </dd>
            <dt>Barysentr.</dt>
            <dd>
              {fmtD(info.bary[0], 4)} / {fmtD(info.bary[1], 4)} / {fmtD(info.bary[2], 4)}
            </dd>
            <dt>Spiraali P2</dt>
            <dd>
              {fmtDec(info.v2.x, 2)}, {fmtDec(info.v2.y, 2)} (r = √n = {fmtDec(Math.sqrt(n), 2)})
            </dd>
            <dt>P5</dt>
            <dd>
              ({fmtD(p5[0], 3)}, {fmtD(p5[1], 3)}, {fmtD(p5[2], 3)}, {fmtN(p5[3])}, {p5[4] == null ? 'null' : fmtDate(new Date(p5[4]).toISOString())})
            </dd>
          </dl>

          {!isAnchor && (
            <>
              <div className="eyebrow">Suhde ankkuriin {anchorTerm?.label} @{fmtN(anchor.n)}</div>
              <dl className="kv">
                <dt>1D Δn</dt>
                <dd>{fmtSigned(info.d1)} desimaalia</dd>
                <dt>Fibonacci</dt>
                <dd>
                  {info.fk != null
                    ? `|Δn| = F${info.fk} täsmälleen`
                    : `lähin F${info.nf.k} = ${fmtN(info.nf.F)} (ero ${fmtSigned(info.nf.delta)})`}
                </dd>
                <dt>3D chord</dt>
                <dd>{fmtD(info.d3, 4)} (suora etäisyys, ei pintareitti)</dd>
                <dt>Pintasuhde</dt>
                <dd>{info.rel}</dd>
                <dt>Rakenne</dt>
                <dd>
                  kulmaero {fmtDec(info.struct.angleDeg, 1)}°, z-siirto {fmtD(info.struct.zShift, 3)}
                </dd>
              </dl>
              <div className="faint" style={{ fontSize: 12 }}>
                Rakenne: indeksiero kääntää kulmaa Δn·137,5° ja siirtää z:aa 2·fract(Δn·(√2−1)). Pisteet ovat 3D:ssä
                lähellä vain, jos molemmat ovat pieniä.
              </div>
            </>
          )}

          <dl className="kv">
            <dt>Edellinen {term.label}</dt>
            <dd>
              {info.prev != null ? (
                <button className="btn small ghost" onClick={() => select({ termId, n: info.prev! })}>
                  @{fmtN(info.prev)} ({fmtSigned(info.prev - n)})
                </button>
              ) : (
                '–'
              )}
            </dd>
            <dt>Seuraava {term.label}</dt>
            <dd>
              {info.next != null ? (
                <button className="btn small ghost" onClick={() => select({ termId, n: info.next! })}>
                  @{fmtN(info.next)} ({fmtSigned(info.next - n)})
                </button>
              ) : (
                '–'
              )}
            </dd>
          </dl>

          <div className="eyebrow">Elämäntapahtuma (käyttäjän linkitys)</div>
          {events.length === 0 ? (
            <div className="faint" style={{ fontSize: 13 }}>
              Ei tapahtumia. Lisää tapahtuma hakupaneelin Tapahtumat-välilehdellä; linkitys tehdään aina käsin.
            </div>
          ) : (
            <div className="row">
              {events.map((e) => (
                <button
                  key={e.id}
                  className="toggle"
                  aria-pressed={e.linkedHits.includes(key)}
                  onClick={() => toggleEventLink(e.id, { termId, n })}
                >
                  <span className="dot" /> {e.title} · {fmtDate(e.date)}
                </button>
              ))}
            </div>
          )}
          {linked.length > 0 && (
            <div className="note">
              Linkitetty käyttäjän valinnalla. Linkki ei ole matemaattinen havainto eikä todiste yhteydestä.
            </div>
          )}

          <label className="field">
            <span>OMA TULKINTA (erillään matemaattisesta datasta)</span>
            <textarea
              id={`note-${key}`}
              className="input"
              value={notes[key] ?? ''}
              placeholder="Mitä tämä osuma merkitsee sinulle? Tallentuu vain tälle laitteelle."
              onChange={(e) => setNote(key, e.target.value)}
            />
          </label>
        </>
      )}
    </div>
  );
}

export function selectedTermColor(): string {
  const s = store.get();
  return s.terms.find((t) => t.id === s.selection?.termId)?.color ?? 'var(--teal)';
}
