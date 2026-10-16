// Kaksi erillistä, synkronoitua aikajanaa: π-indeksi (järjestys) ja elämäntapahtumat (kalenteri).
// Yhdysviivat näkyvät vain käyttäjän itse tekemille linkeille.

import { useState } from 'react';
import { eventTimestamp, hitKey, parseHitKey } from '../../core/types';
import { openPanel, select } from '../../state/actions';
import { useApp } from '../../state/store';
import { fmtDate, fmtN } from '../format';
import { useWidth } from './useWidth';

export function Timelines() {
  const events = useApp((s) => s.events);
  const terms = useApp((s) => s.terms);
  const N = useApp((s) => s.digits.length);
  const sel = useApp((s) => s.selection);
  const anchor = useApp((s) => s.anchor);
  const [activeEvent, setActiveEvent] = useState<string | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>();

  const dated = events
    .map((e) => ({ e, t: eventTimestamp(e) }))
    .filter((x): x is { e: (typeof events)[number]; t: number } => x.t != null)
    .sort((a, b) => a.t - b.t);

  const H = 190;
  const yPi = 46;
  const yEv = 146;
  const xPi = (n: number) => 20 + (n / Math.max(1, N)) * (W - 40);
  let t0 = dated.length ? dated[0].t : Date.now() - 365 * 864e5;
  let t1 = dated.length ? dated[dated.length - 1].t : Date.now();
  if (t1 - t0 < 864e5 * 30) {
    t0 -= 864e5 * 15;
    t1 += 864e5 * 15;
  }
  const pad = (t1 - t0) * 0.06;
  t0 -= pad;
  t1 += pad;
  const xEv = (t: number) => 20 + ((t - t0) / (t1 - t0)) * (W - 40);
  const selKey = sel ? hitKey(sel) : null;
  const termOf = (id: string) => terms.find((t) => t.id === id);

  return (
    <div className="section">
      <div className="eyebrow">Aikajanat · 5D-tietomalli</div>
      <div className="faint" style={{ fontSize: 12.5 }}>
        Ylempi jana on piin järjestysindeksi n (”π-järjestysaika”, ei fyysistä aikaa). Alempi jana on oikea kalenteriaika
        käyttäjän tapahtumista. P5 = (x, y, z, n, tapahtuman aikaleima) vain, jos olet itse linkittänyt osuman
        tapahtumaan; muuten viides arvo on null.
      </div>
      {events.length === 0 ? (
        <div className="card flat row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Ei vielä elämäntapahtumia.</span>
          <button className="btn small" onClick={() => openPanel('events')}>
            Lisää tapahtuma
          </button>
        </div>
      ) : (
        <div ref={ref} style={{ width: '100%' }}>
          <svg className="chart timeline-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }} role="img" aria-label="π-indeksi ja elämäntapahtumat">
            <text x={20} y={yPi - 26}>π-indeksi n</text>
            <line className="axis" x1={20} x2={W - 20} y1={yPi} y2={yPi} />
            <text x={20} y={yPi + 16}>1</text>
            <text x={W - 20} y={yPi + 16} textAnchor="end">
              {fmtN(N)}
            </text>
            <text x={20} y={yEv - 26}>Elämäntapahtumat (kalenteri)</text>
            <line className="axis" x1={20} x2={W - 20} y1={yEv} y2={yEv} />
            <text x={20} y={yEv + 18}>{fmtDate(new Date(t0).toISOString())}</text>
            <text x={W - 20} y={yEv + 18} textAnchor="end">
              {fmtDate(new Date(t1).toISOString())}
            </text>
            <g>
              <line x1={xPi(anchor.n)} x2={xPi(anchor.n)} y1={yPi - 12} y2={yPi + 4} stroke="var(--teal)" strokeWidth={2} />
            </g>
            {dated.map(({ e, t }) =>
              e.linkedHits.map((k) => {
                const ref = parseHitKey(k);
                if (!ref) return null;
                const term = termOf(ref.termId);
                const on = activeEvent === e.id || selKey === k;
                return (
                  <line
                    key={`${e.id}-${k}`}
                    x1={xEv(t)}
                    y1={yEv - 6}
                    x2={xPi(ref.n)}
                    y2={yPi + 6}
                    stroke={term?.color ?? 'var(--fg-3)'}
                    strokeWidth={on ? 2.4 : 1.2}
                    opacity={on ? 1 : 0.55}
                  />
                );
              }),
            )}
            {dated.flatMap(({ e }) =>
              e.linkedHits.map((k) => {
                const ref = parseHitKey(k);
                if (!ref) return null;
                const term = termOf(ref.termId);
                const on = selKey === k;
                return (
                  <circle
                    key={`h-${e.id}-${k}`}
                    cx={xPi(ref.n)}
                    cy={yPi}
                    r={on ? 7 : 5}
                    fill={term?.color ?? 'var(--fg-3)'}
                    style={{ cursor: 'pointer' }}
                    onClick={() => select(ref)}
                  />
                );
              }),
            )}
            {sel && <circle cx={xPi(sel.n)} cy={yPi} r={9} fill="none" stroke="var(--fg)" strokeWidth={1.5} />}
            {dated.map(({ e, t }) => {
              const on = activeEvent === e.id || (selKey != null && e.linkedHits.includes(selKey));
              return (
                <g
                  key={e.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setActiveEvent(e.id);
                    const first = e.linkedHits.map(parseHitKey).find((x) => x);
                    if (first) select(first);
                  }}
                >
                  <rect x={xEv(t) - 6} y={yEv - 6} width={12} height={12} rx={3} fill={on ? 'var(--gold)' : 'var(--fg-2)'} />
                  <text x={xEv(t)} y={yEv + 34} textAnchor="middle" style={{ fill: on ? 'var(--gold)' : undefined }}>
                    {e.title.length > 18 ? e.title.slice(0, 17) + '…' : e.title}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
