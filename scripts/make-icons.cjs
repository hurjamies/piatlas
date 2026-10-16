// Luo sovelluskuvakkeet: public/icon.svg sekä PNG-koot (Chromium/Playwright rasterointiin).
// Ajo: NODE_PATH=$(npm root -g) node scripts/make-icons.cjs
const fs = require('fs');
const path = require('path');
const GAMMA = Math.PI * (3 - Math.sqrt(5));

function svg(maskable) {
  const pad = maskable ? 0 : 0;
  const R = maskable ? 120 : 150;
  const dots = [];
  for (let n = 1; n <= 260; n++) {
    const r = (Math.sqrt(n) / Math.sqrt(260)) * R;
    const t = n * GAMMA;
    const x = 256 + r * Math.cos(t);
    const y = 256 + r * Math.sin(t);
    const s = 2.2 + 3.4 * (1 - n / 260);
    const o = (0.35 + 0.65 * (1 - n / 260)).toFixed(2);
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(2)}" fill="#f4c56b" opacity="${o}"/>`);
  }
  const k = maskable ? 0.78 : 1;
  const P = (x, y) => `${(256 + (x - 256) * k).toFixed(1)} ${(256 + (y - 256) * k).toFixed(1)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${maskable ? '' : 'rx="112"'} fill="#070b14"/>
  <g fill="none" stroke="#2b4562" stroke-width="6" stroke-linejoin="round">
    <path d="M${P(76, 256)} L${P(436, 256)}"/>
    <path d="M${P(256, 58)} L${P(204, 256)} L${P(256, 454)}"/>
    <path d="M${P(256, 58)} L${P(308, 256)} L${P(256, 454)}"/>
  </g>
  ${dots.join('\n  ')}
  <path d="M${P(256, 58)} L${P(436, 256)} L${P(256, 454)} L${P(76, 256)} Z" fill="none" stroke="#72e1d1" stroke-width="14" stroke-linejoin="round"/>
  <circle cx="256" cy="256" r="11" fill="#72e1d1"/>
</svg>
`;
}

const pub = path.join(__dirname, '..', 'public');
fs.writeFileSync(path.join(pub, 'icon.svg'), svg(false));
fs.writeFileSync(path.join(pub, 'icon-maskable.svg'), svg(true));

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [file, size, src] of [
    ['icon-192.png', 192, 'icon.svg'],
    ['icon-512.png', 512, 'icon.svg'],
    ['icon-maskable-512.png', 512, 'icon-maskable.svg'],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    const data = fs.readFileSync(path.join(pub, src), 'utf8');
    await page.setContent(`<html><body style="margin:0;background:transparent">${data.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(pub, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
  fs.unlinkSync(path.join(pub, 'icon-maskable.svg'));
  console.log('icons ok');
})();
