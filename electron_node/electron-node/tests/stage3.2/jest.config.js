module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>', '<rootDir>/../../main/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/../../tsconfig.main.json',
      isolatedModules: true, // 提高性能，跳过类型检查
      useESM: false,
    }],
  },
  // 确保 TypeScript 文件不被 Babel 处理
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))',
  ],
  moduleDirectories: ['node_modules', '<rootDir>', '<rootDir>/../../'],
  moduleNameMapper: {
    '^electron$': '<rootDir>/../../__mocks__/electron.js',
    '^../logger$': '<rootDir>/../../__mocks__/logger.ts',
    '^../../main/src/logger$': '<rootDir>/../../__mocks__/logger.ts',
    '^../../../main/src/logger$': '<rootDir>/../../__mocks__/logger.ts',
    '^@shared/(.*)$': '<rootDir>/../../../shared/$1.ts',
    // 映射 main/src 下的模块
    '^../../../main/src/(.*)$': '<rootDir>/../../main/src/$1',
  },
  collectCoverageFrom: [
    '../../main/src/platform-adapter/**/*.ts',
    '../../main/src/service-registry/**/*.ts',
    '../../main/src/service-package-manager/**/*.ts',
    '../../main/src/service-runtime-manager/**/*.ts',
    '../../main/src/pipeline-orchestrator/**/*.ts',
    '../../main/src/task-router/**/*.ts',
    '!../../main/src/**/*.d.ts',
  ],
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // 避免循环引用错误
  maxWorkers: 1,
  // 抑制 console.error 输出（避免 axios 错误日志干扰）
  silent: false,
  verbose: true,
};

