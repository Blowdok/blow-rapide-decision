import { defineConfig } from '@playwright/test';

// Tests de bout en bout de l'application de bureau (Electron), après `npm run build`.
export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results'
});
