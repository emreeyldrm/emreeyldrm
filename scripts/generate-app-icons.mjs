#!/usr/bin/env node
// Voyage uygulama simgelerini ve açılış ekranı görselini tema renkleriyle üretir (mobile/assets/*.png).
// Kullanım (repo kökünde):  node scripts/generate-app-icons.mjs
// Gerekenler: mobile/node_modules (Playwright + pngjs) ve bir Chromium
//   (PLAYWRIGHT_BROWSERS_PATH ya da `cd mobile && npx playwright install chromium`).
// SVG, Chromium'da çizilip ekran görüntüsü alınır; iOS simgesi pngjs ile alfa kanalı olmadan (RGB) yazılır.
import { createRequire } from 'node:module';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mobile = join(root, 'mobile');
const out = join(mobile, 'assets');
const require = createRequire(join(mobile, 'package.json'));
const { chromium } = require('@playwright/test');
const { PNG } = require('pngjs');

const GREEN = '#2E7D5B';
const GREEN_DARK = '#1F6648';
const ORANGE = '#F28C28';
const WHITE = '#FFFFFF';

// İşaret: beyaz konum iğnesi, ortasında turuncu nokta. viewBox 0 0 100 100, iğne (50,50) çevresinde ortalı.
const PIN = 'M50 10C33.4 10 20 23.2 20 39.6C20 61.5 50 90 50 90S80 61.5 80 39.6C80 23.2 66.6 10 50 10Z';
const mark = ({ pin = WHITE, dot = ORANGE, scale = 1 }) => `
  <g transform="translate(50 50) scale(${scale}) translate(-50 -50)">
    <path d="${PIN}" fill="${pin}"/>
    ${dot ? `<circle cx="50" cy="39.5" r="12" fill="${dot}"/>` : ''}
  </g>`;
const svg = (size, body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  ${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ''}${body}</svg>`;

// Simge: yeşil degrade zemin, iğnenin altında hafif gölge.
const iconBody = `
  <defs><radialGradient id="g" cx="50%" cy="35%" r="75%">
    <stop offset="0" stop-color="#3A9670"/><stop offset="1" stop-color="${GREEN}"/></radialGradient></defs>
  <rect width="100" height="100" fill="url(#g)"/>
  <ellipse cx="50" cy="85" rx="16" ry="3.2" fill="${GREEN_DARK}" opacity="0.55"/>
  ${mark({ scale: 0.72 })}`;

const assets = [
  // iOS / genel simge: 1024, opak (alfa yok)
  { file: 'icon.png', size: 1024, svg: svg(1024, iconBody), opaque: true },
  // Android uyarlanabilir simge: ön plan güvenli alanda (ortadaki %66), arka plan düz yeşil
  { file: 'android-icon-foreground.png', size: 1024, svg: svg(1024, mark({ scale: 0.5 })) },
  { file: 'android-icon-background.png', size: 1024, svg: svg(1024, '', GREEN), opaque: true },
  // Tek renkli (Android 13+ temalı simge): yalnızca alfa kullanılır, nokta delik olarak kesilir
  { file: 'android-icon-monochrome.png', size: 1024, svg: svg(1024,
      `<g transform="translate(50 50) scale(0.5) translate(-50 -50)"><path fill-rule="evenodd" fill="${WHITE}"
        d="${PIN} M62 39.5a12 12 0 1 0 -24 0a12 12 0 1 0 24 0Z"/></g>`) },
  // Açılış ekranı: yeşil zemin (app.config.ts) üzerinde beyaz/turuncu işaret, şeffaf
  { file: 'splash-icon.png', size: 1024, svg: svg(1024, mark({ scale: 0.9 })) },
  { file: 'favicon.png', size: 48, svg: svg(48, iconBody), opaque: true },
];

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const p = join(base, d, 'chrome-linux', 'chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: findChromium() });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const a of assets) {
    await page.setViewportSize({ width: a.size, height: a.size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${a.svg}</body></html>`);
    const target = join(out, a.file);
    const buf = await page.locator('svg').screenshot({ omitBackground: !a.opaque });
    const png = PNG.sync.read(buf);
    if (png.width !== a.size || png.height !== a.size) throw new Error(`${a.file}: ${png.width}x${png.height}`);
    // Opak görseller RGB (colorType 2), diğerleri RGBA yazılır.
    writeFileSync(target, PNG.sync.write(png, a.opaque ? { colorType: 2, inputHasAlpha: true } : { colorType: 6 }));
    console.log(`${a.file.padEnd(30)} ${a.size}x${a.size} ${a.opaque ? 'RGB' : 'RGBA'}`);
  }
} finally {
  await browser.close();
}
