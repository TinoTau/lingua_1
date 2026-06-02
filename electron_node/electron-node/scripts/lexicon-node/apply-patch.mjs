#!/usr/bin/env node
/**
 * @deprecated Use npm run lexicon:patch:apply (V3.1 SQLite Patch Service).
 */
console.error(
  '[deprecated] lexicon-node/apply-patch.mjs removed with lexicon-update.\n' +
    'Use: npm run build:main && npm run lexicon:patch:apply -- <patch.json>'
);
process.exit(1);
