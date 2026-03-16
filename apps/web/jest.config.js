const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const isCI = process.env.CI === 'true';

/** @type {import('jest').Config} */
const config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: [
    '**/__tests__/**/*.(test|spec).(ts|tsx)',
    '**/*.(test|spec).(ts|tsx)',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/e2e/',
  ],
  collectCoverageFrom: [
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },

  // ── Performance optimizations ──────────────────────────────────────────────
  // Use 50% of available CPUs in CI (avoids OOM on 2-core runners),
  // use 75% locally for faster feedback.
  maxWorkers: isCI ? '50%' : '75%',

  // Cache transformed files between runs for faster subsequent executions
  cache: true,
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',

  // Skip transforming large node_modules that don't need it
  transformIgnorePatterns: [
    '/node_modules/(?!(swr|@radix-ui|lucide-react)/)',
  ],

  // Faster test isolation — resets mocks but reuses worker processes
  workerIdleMemoryLimit: '512MB',
};

module.exports = createJestConfig(config);
