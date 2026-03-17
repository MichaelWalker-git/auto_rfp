const isCI = process.env.CI === 'true';

/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.env.js'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^helpers/(.*)$': '<rootDir>/src/helpers/$1',
    '^middleware/(.*)$': '<rootDir>/src/middleware/$1',
    // Mock uuid to avoid ESM transformation issues
    '^uuid$': '<rootDir>/jest.uuid-mock.js',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: './tsconfig.test.json',
        // Skip type-checking during transform — major speedup (2-5x faster)
        // Type safety is enforced by `tsc --noEmit` in CI separately
        isolatedModules: true,
        // Use AST-based transformation (faster than program-based)
        diagnostics: false,
      },
    ],
  },
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transformIgnorePatterns: [
    'node_modules/(?!(@auto-rfp)/)',
  ],

  // ── Performance optimizations ──────────────────────────────────────────────
  // Use 75% of CPUs locally for faster feedback, 50% in CI to avoid OOM on 2-core runners
  maxWorkers: isCI ? '50%' : '75%',
  testTimeout: 10000,
  workerIdleMemoryLimit: '512MB',

  // Cache transformed files between runs for faster subsequent executions
  cache: true,
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',

  // Don't bail on first failure
  bail: 0,

  // Coverage collection can be memory-intensive - disable by default
  collectCoverage: false,
};
