// Matriisin loki: avaukset, suunnanvaihdot, 369- ja hyppyoperaatiot, tallennukset, reittitestit, tarkistukset ja
// tarinan muokkaukset. Uusin ensin.
import { useState } from 'react';
import type { MatrixLogKind } from '../../core/matrix/types';
import { useApp } from '../../state/store';
import { fmtDateTime } from '../format';

const KINDS: MatrixLogKind[] = ['avaus', 'suunta', '369', 'hyppy', 'tallennus', 'vertailu', 'tarkistus', 'tarina'];
const SHOWN = 60;

export function LogPage() {
  const log = useApp((s) => s.matrix.log);
  const [kind, setKind] = useState<MatrixLogKind | null>(null);
  const [all, setAll] = useState(false);
  const counts = new Map<MatrixLogKind, number>();
  for (const e of log) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const rows = [...log].reverse().filter((e) => !kind || e.kind === kind);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <section className="section" aria-label="Matriisin loki" data-testid="matrix-log">
      <div className="eyebrow">Matriisin loki</div>
      <div className="mx-small faint">
        Tutkimuksen kannalta olennaiset merkinnät (369, hyppysäännöt, reittitestit, lukitukset, tallennukset ja tarinan
        muokkaukset) kirjataan myös yhteiseen muutoshistoriaan (Testit → Vienti). Laitteelle tallentuu 500 uusinta.
      </div>
      <div className="mx-code-chips" role="group" aria-label="Suodata lajin mukaan">
        <button type="button" className="toggle" aria-pressed={kind === null} onClick={() => setKind(null)}>
          kaikki · {log.length}
        </button>
        {KINDS.map((k) => (
          <button key={k} type="button" className="toggle" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)} disabled={!counts.get(k)}>
            {k} · {counts.get(k) ?? 0}
          </button>
        ))}
      </div>
      {!log.length && <div className="muted mx-small">Loki on tyhjä. Avaa solmuja matriisissa.</div>}
      <div className="card mx-log">
        {shown.map((e, i) => (
          <div key={`${e.ts}-${i}`} className="mx-log-row">
            <span className="mono faint">{fmtDateTime(e.ts)}</span> <span className={`pill mx-log-kind k-${e.kind}`}>{e.kind}</span> {e.text}
            {e.ref && <span className="mono faint"> · {e.ref}</span>}
          </div>
        ))}
        {!shown.length && log.length > 0 && <div className="muted mx-small">Ei merkintöjä tällä suodattimella.</div>}
      </div>
      {rows.length > SHOWN && (
        <button type="button" className="mx-btn ghost" onClick={() => setAll(!all)}>
          {all ? 'Näytä vähemmän' : `Näytä kaikki (${rows.length})`}
        </button>
      )}
    </section>
  );
}
