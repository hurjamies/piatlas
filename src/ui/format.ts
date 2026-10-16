/** 858511 → "858 511" (ohut sitova väli tuhaterottimena). */
export function fmtN(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  const s = Math.round(Math.abs(n)).toString();
  const g = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (n < 0 ? '−' : '') + g;
}

export function fmtSigned(n: number): string {
  return (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtN(Math.abs(n));
}

export function fmtD(x: number | null | undefined, digits = 4): string {
  if (x == null || !Number.isFinite(x)) return '–';
  return x.toFixed(digits).replace('.', ',');
}

export function fmtDec(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return '–';
  return x.toFixed(digits).replace('.', ',');
}

export function fmtPct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '–';
  return (x * 100).toFixed(digits).replace('.', ',') + ' %';
}

export function fmtExpected(x: number): string {
  if (!Number.isFinite(x)) return '–';
  if (x >= 100) return fmtN(x);
  if (x >= 1) return x.toFixed(1).replace('.', ',');
  if (x >= 0.001) return x.toFixed(3).replace('.', ',');
  return x.toExponential(1).replace('.', ',');
}

export function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  return d.toLocaleDateString('fi-FI', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function fmtDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtMetric(metric: '1d' | '2d' | '3d', v: number): string {
  if (!Number.isFinite(v)) return '–';
  if (metric === '1d') return `${fmtN(v)} des.`;
  if (metric === '2d') return fmtDec(v, 2);
  return fmtD(v, 4);
}

/** Desimaalipilkku tekstiin, jonka ydinkirjasto muotoili pisteellä. */
export function fiNum(s: string): string {
  return s.replace(/(\d)\.(\d)/g, '$1,$2');
}

export function fmtPfi(p: number): string {
  if (!Number.isFinite(p)) return '–';
  const s = p < 0.001 ? p.toExponential(1) : p.toFixed(p < 0.01 ? 4 : 3);
  return fiNum(s);
}
