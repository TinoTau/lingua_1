/** P0-Guard pipeline contract tests */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^electron$': '<rootDir>/../../__mocks__/electron.js',
    '^@shared/(.*)$': '<rootDir>/../../../shared/$1.ts',
    '^../../main/src/logger$': '<rootDir>/../../main/__mocks__/logger.ts',
  },
  testTimeout: 30000,
};
