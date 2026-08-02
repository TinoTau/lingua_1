/** Schema V2 Only — legacy V1 lexicon build is disabled. */

export const LEGACY_BUILD_DISABLED_MESSAGE = `[lexicon] Legacy lexicon build is disabled.

Schema V2 only path:
  npm run lexicon:validate
  npm run lexicon:build:v2-shadow
  npm run lexicon:prepare:v3-runtime
  npm run lexicon:gate:v3-runtime
  npm run lexicon:rebuild-sqlite
  restart node
`;

export function failLegacyLexiconBuild(label = 'lexicon:build') {
  console.error(`${label}: ${LEGACY_BUILD_DISABLED_MESSAGE}`);
  process.exit(1);
}
