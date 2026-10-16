// Tulostaa ensimmäisen kontrolloidun läheisyystestin tulokset dokumentaatiota varten.
// Ajo: npx vite-node scripts/stats-summary.ts
import { readFileSync } from 'node:fs';
import { chordDistance, faceName, faceBits, mapIndex } from '../src/core/mapping';
import { findAll } from '../src/core/search';
import { runMonteCarlo, runRandomControl } from '../src/core/stats';

const d = readFileSync(new URL('../public/data/pi_digits_1m.txt', import.meta.url), 'utf8').trim();
const ida = findAll('432', d), matti = findAll('62884', d), mini = findAll('6464', d);
const A = mapIndex(858511), M = mapIndex(858260), I = mapIndex(858960);
console.log('IDA@858511', A, faceName(faceBits(A)));
console.log('MATTI@858260', M, faceName(faceBits(M)), 'chord', chordDistance(A, M).toFixed(4));
console.log('MINI@858960', I, faceName(faceBits(I)), 'chord', chordDistance(A, I).toFixed(4));
const base = { hitsA: ida, lenA: 3, hitsB: matti, lenB: 5, sameTerm: false, N: d.length, R: 10000, seed: 20251016, alpha: 0.05 };
for (const [statistic, metric] of [['anchorNearest', '1d'], ['anchorNearest', '3d'], ['setMin', '1d'], ['setMin', '3d'], ['meanNearest', '3d']] as const) {
  const r = await runMonteCarlo({ ...base, statistic, metric, anchorN: statistic === 'anchorNearest' ? 858511 : null });
  console.log(statistic, metric, 'obs', r.observed.toPrecision(4), 'p', r.pValue.toPrecision(3), `[${r.pLow.toPrecision(3)}, ${r.pHigh.toPrecision(3)}]`, 'median', r.nullMedian.toPrecision(4), `${r.durationMs} ms`);
}
const mi = await runMonteCarlo({ ...base, hitsB: mini, lenB: 4, statistic: 'anchorNearest', metric: '3d', anchorN: 858511 });
console.log('MINI anchorNearest 3d obs', mi.observed.toPrecision(4), 'p', mi.pValue.toPrecision(3));
const rc = await runRandomControl({ codeA: '432', codeB: '62884', metric: '3d', statistic: 'setMin', N: d.length, strings: 100, seed: 20251016 }, d);
console.log('random control 3d setMin: pi', rc.pi.value.toPrecision(4), 'shareLE', rc.shareLE, 'meanA', rc.meanCountA, 'meanB', rc.meanCountB);
