const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  // 依赖 Node --experimental-vm-modules 的测试（opus 动态 import）默认排除
  testPathIgnorePatterns: [
    "/node_modules/",
    "opus-encoder.test.ts",
    "task-router-opus.test.ts",
    "service-registry.test.ts",
    "service-package-manager.test.ts",
    "capability_by_type.test.ts",
    "rerun-metrics.test.ts",
    "session-context-manager.test.ts",
    "asr-metrics.test.ts",
  ],
  transform: {
    ...tsJestTransformCfg,
  },
  moduleNameMapper: {
    "^@shared/(.*)$": "<rootDir>/../shared/$1",
  },
};