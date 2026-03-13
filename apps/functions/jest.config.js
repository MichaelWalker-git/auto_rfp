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
      },
    ],
  },
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transformIgnorePatterns: [
    'node_modules/(?!(@auto-rfp)/)',
  ],
  // Performance optimizations to prevent system overload
  maxWorkers: '50%', // Use only 50% of available CPU cores
  testTimeout: 10000, // 10 second timeout per test
  workerIdleMemoryLimit: '512MB', // Kill workers using too much memory
  bail: 0, // Don't bail on first test failure (set to 1 to stop after first failure)
  // Coverage collection can be memory-intensive - disable by default
  collectCoverage: false,
};
