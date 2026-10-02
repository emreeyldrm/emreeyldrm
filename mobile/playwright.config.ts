import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E2E against the Expo WEB export.
 *   default:            NestJS contract server (../server, port 3100, in-memory DB)
 *   E2E_API=workers:    Cloudflare Worker (../backend, port 8790)
 * The web export is rebuilt with the matching EXPO_PUBLIC_API_URL and served statically on port 5175.
 */
const workers = process.env.E2E_API === 'workers';
const apiPort = workers ? 8790 : 3100;
const apiUrl = `http://localhost:${apiPort}`;
const webPort = 5175;

function findChromium(): string | undefined {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const p = join(base, d, 'chrome-linux', 'chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}
const executablePath = findChromium();

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    viewport: { width: 390, height: 844 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  metadata: { api: workers ? 'workers' : 'nest', apiUrl },
  webServer: [
    {
      command: 'npm run start:e2e',
      cwd: workers ? '../backend' : '../server',
      port: apiPort,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: `npx expo export --platform web --output-dir web-build --clear && npx serve -s web-build -l ${webPort} --no-clipboard`,
      port: webPort,
      reuseExistingServer: true,
      timeout: 600_000,
      env: { EXPO_PUBLIC_API_URL: apiUrl, EXPO_OFFLINE: '1', CI: '1' },
    },
  ],
});
