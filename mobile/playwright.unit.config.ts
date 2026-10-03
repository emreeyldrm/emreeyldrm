import { defineConfig } from '@playwright/test';

/** Node-only unit tests (no browser, no servers): `npm run test:unit`. */
export default defineConfig({
  testDir: './unit',
  timeout: 30_000,
  reporter: [['list']],
});
