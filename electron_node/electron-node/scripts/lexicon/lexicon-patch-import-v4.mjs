#!/usr/bin/env node
import { runLexiconPatchImportV4 } from './lib/run-lexicon-patch-import-v4.mjs';

const { exitCode, reportPath } = await runLexiconPatchImportV4(process.argv.slice(2));
if (reportPath) {
  console.log(`[lexicon:patch:import] report → ${reportPath}`);
}
process.exit(exitCode);
