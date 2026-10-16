import { chordDistance, faceBits, faceSignLabel, mapIndex } from '../../core/mapping';
import { store, useApp } from '../../state/store';
import { fmtD, fmtN, fmtSigned } from '../format';
import { HitDetails } from './HitDetails';
import { IconChevron } from './Icons';

export function HitSheet() {
  const sel = useApp((s) => s.selection);
  const expanded = useApp((s) => s.sheetExpanded);
  const term = useApp((s) => s.terms.find((t) => t.id === s.selection?.termId));
  const code = useApp((s) => (s.selection ? s.hits[s.selection.termId]?.code : undefined));
  const anchor = useApp((s) => s.anchor);
  const legacy = useApp((s) => s.tab === 'space' && s.spaceMode === 'legacy');
  if (!sel || !term) return null;
  const p = mapIndex(sel.n);
  const isAnchor = anchor.termId === sel.termId && anchor.n === sel.n;
  const d1 = sel.n - anchor.n;
  const d3 = chordDistance(p, mapIndex(anchor.n));
  return (
    <section className="sheet" aria-label="Valittu osuma" data-testid="hit-sheet">
      <button className="sheet-head" onClick={() => store.set({ sheetExpanded: !expanded })} aria-expanded={expanded}>
        <span className="grab" />
        <span className="swatch" style={{ background: term.color }} />
        <span className="sheet-title">
          <span className="t1">
            {term.label}
            <span className="mono muted" style={{ fontSize: 13, fontWeight: 400 }}>
              {code}
            </span>
            <span className="mono" style={{ fontSize: 15 }}>
              @{fmtN(sel.n)}
            </span>
            {isAnchor && <span className="pill coded">ankkuri</span>}
          </span>
          <span className="t2">
            pinta {faceSignLabel(faceBits(p))}
            {isAnchor ? ' · lukittu tutkimusankkuri' : ` · Δn ${fmtSigned(d1)} · 3D ${fmtD(d3, 3)}`}
            {legacy && ' · arvot oletuskartasta'}
          </span>
        </span>
        <IconChevron up={!expanded} />
      </button>
      {expanded && (
        <div className="sheet-body">
          <HitDetails termId={sel.termId} n={sel.n} />
        </div>
      )}
    </section>
  );
}
