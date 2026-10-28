import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
if (!server) throw new Error('The local verification server must be configured.');

/** Opt-in provider verification, separated from the offline fixture suite. */
export default defineConfig({
  ...base,
  testDir: './verification',
  testMatch: 'mapbox-real.spec.ts',
  outputDir: '../output/playwright/final-verification/mapbox-run',
  reporter: [['list']],
  timeout: 75_000,
  use: { ...base.use, trace: 'off', screenshot: 'off' },
  webServer: { ...server, env: { ...server.env, NEEDS_E2E_REAL_MAPBOX: '1' } },
});
