import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: 'browser-smoke.spec.js',
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:8000'
  },
  webServer: {
    command: 'node scripts/serve-static.mjs',
    url: 'http://127.0.0.1:8000',
    reuseExistingServer: true
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ]
});
