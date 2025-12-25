module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../../main/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleDirectories: ['node_modules', '<rootDir>', '<rootDir>/../../'],
  moduleNameMapper: {
    '^electron$': '<rootDir>/../../__mocks__/electron.js',
    '^../logger$': '<rootDir>/../../__mocks__/logger.ts',
    '^../../main/src/logger$': '<rootDir>/../../__mocks__/logger.ts',
    '^@shared/(.*)$': '<rootDir>/../../../shared/$1.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.json',
    },
  },
  collectCoverageFrom: [
    '../../main/src/task-router/**/*.ts',
    '../../main/src/pipeline-orchestrator/**/*.ts',
    '../../main/src/inference/**/*.ts',
    '!../../main/src/**/*.d.ts',
    '!../../main/src/**/*.test.ts',
  ],
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  maxWorkers: 1,
  silent: false,
  verbose: true,
  // 增加进程隔离，避免原生模块崩溃影响主进程
  forceExit: false,
  detectOpenHandles: false,
  // 使用更安全的进程管理
  workerIdleMemoryLimit: '500MB',
};

