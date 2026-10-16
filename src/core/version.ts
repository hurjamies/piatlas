// Muuttumattomat versiotunnukset. Jos jokin kaava, koodaus tai tilastomenetelmä muuttuu,
// tunnus vaihdetaan, jotta vanhat raportit voidaan toistaa täsmälleen samoilla säännöillä.

export const FORMULA_VERSION = 'PIATLAS-MAP-1.0.0';
export const ENCODING_VERSION = 'PIATLAS-ENC-1.0.0';
export const STATS_VERSION = 'PIATLAS-MC-1.0.0';
export const NET_VERSION = 'PIATLAS-NET-1.0.0';

export const FORMULA_TEXT = [
  'gamma = pi * (3 - sqrt(5))            // kultainen kulma (rad)',
  'a     = sqrt(2) - 1                   // toinen irrationaalinen askel',
  'fract(x) = x - floor(x)',
  'theta(n) = n * gamma                  // n = 1-pohjainen desimaali-indeksi',
  'z(n)     = 2 * fract(n * a + 0.5) - 1',
  'u(n)     = (sqrt(1-z^2) cos theta, sqrt(1-z^2) sin theta, z)',
  'p(n)     = u / (|u.x| + |u.y| + |u.z|)  // oktaedrin pinta |x|+|y|+|z| = 1',
  'P2(n)    = (sqrt(n) cos theta, sqrt(n) sin theta)  // Vogelin spiraali',
  'P4       = (x, y, z, n)                // n = pii-järjestysaika, ei fyysinen aika',
  'P5       = (x, y, z, n, eventTimestamp | null)',
].join('\n');

export const LEGACY_FORMULA_TEXT = [
  'LEGACY (vain vertailuun, riippuu N:stä):',
  'z(n) = 1 - 2 * (n - 0.5) / N',
].join('\n');
