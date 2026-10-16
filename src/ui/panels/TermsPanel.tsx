import { useMemo, useState } from 'react';
import { DateFormat, ENCODING_LABELS, EncodingId, ScandiRule, t9Ambiguity } from '../../core/encodings';
import { FIB } from '../../core/fibonacci';
import { expectedCount } from '../../core/search';
import { SearchTerm, termEncoding, TermKind } from '../../core/types';
import { addEvent, addTerm, removeTerm, select, setAnchor, updateTerm } from '../../state/actions';
import { TermHits, useApp } from '../../state/store';
import { fmtExpected, fmtN, fmtSigned } from '../format';

const KIND_LABELS: Record<TermKind, string> = {
  nimi: 'Nimi',
  paikka: 'Paikka',
  päivämäärä: 'Päivämäärä',
  numerojono: 'Numerojono',
  teksti: 'Oma teksti',
};

const PALETTE = ['#72e1d1', '#f4c56b', '#bd9bff', '#8fb6ff', '#ff9db4', '#86e3a8', '#ffb070', '#e6a3ff', '#7fd3ff', '#f0e68c'];

export function TermsPanel() {
  const terms = useApp((s) => s.terms);
  const hits = useApp((s) => s.hits);
  const [open, setOpen] = useState<string | null>('matti');
  return (
    <>
      <div className="note">
        Perinteinen haku etsii vain <b>vierekkäisiä</b> desimaaleja. Jokainen osuma on oma solmunsa: sama nimi eri
        kohdassa on eri osuma.
      </div>
      <div className="section" style={{ gap: 8 }}>
        {terms.map((t) => (
          <TermRow key={t.id} t={t} h={hits[t.id]} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
        ))}
      </div>
      <AddTermForm />
    </>
  );
}

function TermRow({ t, h, open, onToggle }: { t: SearchTerm; h: TermHits | undefined; open: boolean; onToggle: () => void }) {
  const anchor = useApp((s) => s.anchor);
  const sel = useApp((s) => s.selection);
  const [confirmDel, setConfirmDel] = useState(false);
  const [limit, setLimit] = useState(30);
  const sorted = useMemo(() => {
    if (!h || h.status !== 'ready') return [];
    return Array.from(h.hits).sort((a, b) => Math.abs(a - anchor.n) - Math.abs(b - anchor.n));
  }, [h, anchor.n]);
  const status =
    !h ? 'odottaa' : h.status === 'searching' ? 'haetaan…' : h.status === 'error' ? 'virhe' : `${fmtN(h.count)} osumaa`;
  return (
    <div className="term-row" style={{ gridTemplateColumns: 'auto 1fr auto', alignItems: 'start' }}>
      <button
        className="vis"
        style={{ ['--swatch' as string]: t.color }}
        aria-pressed={t.visible}
        aria-label={`${t.label} näkyvissä kartoilla`}
        onClick={() => updateTerm(t.id, { visible: !t.visible })}
      />
      <button onClick={onToggle} style={{ all: 'unset', cursor: 'pointer', minWidth: 0 }} aria-expanded={open}>
        <div className="name">
          <span className="swatch" style={{ background: t.color, marginRight: 7 }} />
          {t.label}
          {t.mode === 'fibSkip' && <span className="pill exp" style={{ marginLeft: 6 }}>F{t.fibK}-hyppy</span>}
        </div>
        <div className="meta">
          {t.encoding} · {h?.code || '—'} · {status}
          {h?.status === 'ready' && ` · odotus ${fmtExpected(h.expected)}`}
        </div>
      </button>
      <span className="faint" style={{ fontSize: 18, lineHeight: 1 }}>
        {open ? '–' : '+'}
      </span>
      {open && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {h?.status === 'error' && <div className="note err">{h.error}</div>}
          {h?.status === 'ready' && h.expected >= 5 && (
            <div className="note warn">
              Lyhyt koodi: satunnaisessa {fmtN(h.positions + h.code.length - 1)} numeron jonossa odotetaan noin{' '}
              {fmtExpected(h.expected)} osumaa. Löydetyt {fmtN(h.count)} osumaa eivät yksilöi nimeä.
            </div>
          )}
          {t.encoding === 'T9' && h?.code && (
            <div className="faint" style={{ fontSize: 12.5 }}>
              T9 ei ole yksikäsitteinen: koodi {h.code} vastaa {fmtN(t9Ambiguity(h.code))} eri kirjainjonoa.
            </div>
          )}
          {h?.truncated && <div className="note warn">Osumia on yli {fmtN(h.count)}; lista katkaistiin.</div>}
          <div className="hit-list" role="list" aria-label={`${t.label}-osumat, lähin ankkuria ensin`}>
            {sorted.slice(0, limit).map((n) => (
              <button
                key={n}
                className={sel?.termId === t.id && sel.n === n ? 'sel' : ''}
                onClick={() => select({ termId: t.id, n })}
              >
                <span>@{fmtN(n)}</span>
                <span className="faint">{anchor.termId === t.id && anchor.n === n ? 'ankkuri' : `Δ ${fmtSigned(n - anchor.n)}`}</span>
              </button>
            ))}
            {sorted.length > limit && (
              <button onClick={() => setLimit(limit + 100)} style={{ justifyContent: 'center', color: 'var(--teal)' }}>
                Näytä lisää ({fmtN(sorted.length - limit)} jäljellä)
              </button>
            )}
          </div>
          <div className="row">
            {sel && sel.termId === t.id && !(anchor.termId === t.id && anchor.n === sel.n) && (
              <button className="btn small" onClick={() => setAnchor(sel)}>
                Valittu ankkuriksi
              </button>
            )}
            {!confirmDel ? (
              <button className="btn small danger" onClick={() => setConfirmDel(true)} disabled={anchor.termId === t.id}>
                Poista termi
              </button>
            ) : (
              <>
                <span className="muted" style={{ fontSize: 13 }}>
                  Poistetaanko {t.label}?
                </span>
                <button className="btn small danger" onClick={() => removeTerm(t.id)}>
                  Poista
                </button>
                <button className="btn small ghost" onClick={() => setConfirmDel(false)}>
                  Peru
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddTermForm() {
  const N = useApp((s) => s.digits.length);
  const count = useApp((s) => s.terms.length);
  const [kind, setKind] = useState<TermKind>('nimi');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [encoding, setEncoding] = useState<EncodingId>('T9');
  const [scandi, setScandi] = useState<ScandiRule>('fi-translit');
  const [uppercase, setUppercase] = useState(true);
  const [dateFormat, setDateFormat] = useState<DateFormat>('YYYYMMDD');
  const [color, setColor] = useState(PALETTE[count % PALETTE.length]);
  const [mode, setMode] = useState<'contiguous' | 'fibSkip'>('contiguous');
  const [fibK, setFibK] = useState(8);
  const [eventDate, setEventDate] = useState('');

  const draft: SearchTerm = {
    id: 'draft',
    label: label || value.toUpperCase(),
    value,
    kind,
    encoding: kind === 'päivämäärä' ? 'RAW' : encoding,
    scandi: encoding === 'T9' && scandi === 'fi-alphabet' ? 'fi-translit' : scandi,
    uppercase,
    dateFormat,
    color,
    visible: true,
    mode,
    fibK,
    createdAt: '',
  };
  const enc = value ? termEncoding(draft) : null;
  const L = enc?.code.length ?? 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!enc?.ok) return;
    const { id: _id, createdAt: _c, ...rest } = draft;
    void _id;
    void _c;
    addTerm({ ...rest, label: rest.label || enc.code, eventDate: eventDate || null });
    if (eventDate) addEvent({ title: rest.label || enc.code, date: eventDate, note: 'Luotu hakutermin yhteydessä. Linkitä osumaan käsin, jos haluat.' });
    setValue('');
    setLabel('');
    setEventDate('');
    setColor(PALETTE[(count + 1) % PALETTE.length]);
  };

  return (
    <form className="card section" onSubmit={submit} style={{ gap: 12 }}>
      <div className="eyebrow">Lisää hakukohde</div>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <label className="field">
          <span>TYYPPI</span>
          <select
            id="term-kind"
            className="input"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as TermKind;
              setKind(k);
              if (k === 'numerojono') setEncoding('RAW');
              else if (encoding === 'RAW') setEncoding('T9');
            }}
          >
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {kind !== 'päivämäärä' ? (
          <label className="field">
            <span>KOODAUS</span>
            <select id="term-encoding" className="input" value={encoding} onChange={(e) => setEncoding(e.target.value as EncodingId)}>
              {(Object.keys(ENCODING_LABELS) as EncodingId[]).map((k) => (
                <option key={k} value={k}>
                  {ENCODING_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            <span>MUOTO</span>
            <select id="term-datefmt" className="input" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
              {(['YYYYMMDD', 'DDMMYYYY', 'DDMMYY', 'DDMM', 'MMDD'] as DateFormat[]).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="field">
        <span>ARVO</span>
        {kind === 'päivämäärä' ? (
          <input id="term-value" className="input" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <input
            id="term-value"
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === 'numerojono' ? 'esim. 1414' : 'esim. Matti'}
            inputMode={kind === 'numerojono' ? 'numeric' : 'text'}
            autoCapitalize="characters"
            autoComplete="off"
          />
        )}
      </label>
      <div className="grid2" style={{ gridTemplateColumns: '1fr auto' }}>
        <label className="field">
          <span>NIMIKE</span>
          <input id="term-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={value.toUpperCase() || 'näytettävä nimi'} />
        </label>
        <label className="field">
          <span>VÄRI</span>
          <input id="term-color" className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 64, padding: 4 }} />
        </label>
      </div>
      {kind !== 'päivämäärä' && (encoding === 'T9' || encoding === 'A1Z26') && (
        <label className="field">
          <span>Å, Ä, Ö</span>
          <select id="term-scandi" className="input" value={scandi} onChange={(e) => setScandi(e.target.value as ScandiRule)}>
            <option value="none">Ei muunnosta (ääkköset ovat virhe)</option>
            <option value="fi-translit">Suomalainen translitterointi Å,Ä→A, Ö→O</option>
            {encoding === 'A1Z26' && <option value="fi-alphabet">Aakkosjärjestys Å=27, Ä=28, Ö=29</option>}
          </select>
        </label>
      )}
      {kind !== 'päivämäärä' && encoding === 'UTF8_3' && (
        <label className="check">
          <input id="term-upper" type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} /> Muunna isoiksi
          kirjaimiksi (MATTI = 077065084084073)
        </label>
      )}
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <label className="field">
          <span>HAKUTILA</span>
          <select id="term-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as 'contiguous' | 'fibSkip')}>
            <option value="contiguous">Peräkkäiset desimaalit</option>
            <option value="fibSkip">Kokeellinen F_k-hyppy</option>
          </select>
        </label>
        <label className="field">
          <span>TAPAHTUMAN AIKA (VAPAAEHT.)</span>
          <input id="term-event" className="input" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </label>
      </div>
      {mode === 'fibSkip' && (
        <>
          <label className="field">
            <span>HYPPY F_k</span>
            <select id="term-fibk" className="input" value={fibK} onChange={(e) => setFibK(Number(e.target.value))}>
              {Array.from({ length: 22 }, (_, i) => i + 3).map((k) => (
                <option key={k} value={k}>
                  F{k} = {fmtN(FIB[k])}
                </option>
              ))}
            </select>
          </label>
          <div className="note warn">
            Hyppypolku lukee numerot kohdista n, n+F_k, n+2F_k, … Se ei ole piin peräkkäinen merkkijono, ja se merkitään
            aina kokeelliseksi.
          </div>
        </>
      )}
      {enc && (
        <div className={`note ${enc.ok ? '' : 'err'}`}>
          {enc.ok ? (
            <>
              Koodi <b className="mono">{enc.code}</b> ({L} numeroa). {enc.rule}.
              <br />
              Lukutapa: <span className="mono">{enc.steps.map((s) => `${s.ch}→${s.out}`).join(' ')}</span>
              <br />
              Odotus satunnaisessa {fmtN(N)} numeron jonossa: {fmtExpected(expectedCount(N, L))} osumaa.
              {draft.encoding === 'T9' && ` T9-koodi vastaa ${fmtN(t9Ambiguity(enc.code))} kirjainjonoa.`}
            </>
          ) : (
            enc.errors.join(' ')
          )}
        </div>
      )}
      <button className="btn primary" type="submit" disabled={!enc?.ok}>
        Lisää ja hae
      </button>
    </form>
  );
}
