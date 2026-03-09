import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/__e2e__',
  testMatch: '**/*.test.ts',
  timeout: 30000,
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/html-report' }]
  ],
  outputDir: 'test-results/failures',
});
