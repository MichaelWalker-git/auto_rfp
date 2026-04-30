import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    testIsolation: false,
    experimentalRunAllSpecs: true,
    baseUrl: 'https://develop.d70pzc5nkm8k5.amplifyapp.com',
    viewportWidth: 1440,
    viewportHeight: 900,
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    responseTimeout: 15000,
    video: false,
    screenshotOnRunFailure: true,
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.ts',
    retries: {
      runMode: 1,
      openMode: 0,
    },
  },
});
