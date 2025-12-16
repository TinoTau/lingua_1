module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^electron$': '<rootDir>/../../__mocks__/electron.js',
    '^../logger$': '<rootDir>/../../__mocks__/logger.ts',
    '^../../main/src/logger$': '<rootDir>/../../__mocks__/logger.ts',
  },
  collectCoverageFrom: [
    '../../main/src/model-manager/**/*.ts',
    '!../../main/src/model-manager/**/*.d.ts',
  ],
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // 避免循环引用错误
  maxWorkers: 1,
  // 抑制 console.error 输出（避免 axios 错误日志干扰）
  silent: false,
  verbose: true,
};

