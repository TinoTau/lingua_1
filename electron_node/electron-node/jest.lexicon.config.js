const base = require('./jest.config.js');

/** Lexicon 单测（不含 better-sqlite3 / Electron runtime 用例；节点验收用 dialog_200） */
module.exports = {
  ...base,
  testMatch: ['**/main/src/lexicon/**/*.test.ts'],
  testPathIgnorePatterns: [
    ...(base.testPathIgnorePatterns || []),
    'lexicon-runtime.test.ts',
    'pinyin-topk-lookup.test.ts',
    'lexicon-recall.test.ts',
    'lexicon-p1-build.test.ts',
    'window-recall.test.ts',
  ],
};
