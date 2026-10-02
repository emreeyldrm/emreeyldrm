import { defineConfig } from '@playwright/test';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    {
      command: 'npm run start:e2e',
      cwd: '../server',
      port: 3100,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npm run preview',
      port: 5174,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { VITE_API_URL: 'http://localhost:3100' },
    },
  ],
});
