// Muuntaa yhden tiedoston Vite-rakennelman claude.ai-julkaisun muotoon:
// alusta lisää oman <!doctype>/<html>/<head>/<body>-rungon, joten ne poistetaan tästä.
// Numerotiedosto julkaistaan erillisenä tiedostona polussa data/pi_digits_1m.txt.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-artifact');
const html = readFileSync(join(out, 'index.html'), 'utf8');

const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
const body = /<body>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? '';

const styles = [...head.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)]
  .map((m) => m[0])
  .filter((s) => !s.includes('safe-area-inset-top')); // alusta hoitaa turva-alueen itse
const scripts = [...(head + body).matchAll(/<script[^>]*>[\s\S]*?<\/script>/gi)].map((m) => m[0].replace(/ crossorigin/g, ''));
const fonts = [...head.matchAll(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/gi)].map((m) => m[0]);
const bodyRest = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').trim();

const page = [
  '<title>PI ATLAS</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  '<meta name="description" content="PI ATLAS — The Geometry of a Life">',
  ...fonts,
  ...styles,
  bodyRest,
  ...scripts,
  '',
].join('\n');

writeFileSync(join(out, 'index.html'), page);
mkdirSync(join(out, 'data'), { recursive: true });
copyFileSync(join(root, 'public', 'data', 'pi_digits_1m.txt'), join(out, 'data', 'pi_digits_1m.txt'));
console.log(`artifact: ${(page.length / 1024).toFixed(0)} kB + data/pi_digits_1m.txt`);
