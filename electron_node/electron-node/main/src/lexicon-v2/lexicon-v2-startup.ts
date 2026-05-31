/**
 * Lexicon V2 startup contract logging.
 */

import logger from '../logger';
import { isLexiconV2Enabled, getLexiconV2CpuWorkerConfig, getLexiconV2IntentMode } from './lexicon-v2-config';
import { isLexiconRuntimeV2Enabled } from './lexicon-runtime-v2-config';
import { ensureLexiconRuntimeV2Loaded } from './lexicon-runtime-v2-holder';
import { resolveLexiconIntentModelPath } from './lexicon-intent-model-path';

export function logLexiconV2StartupContract(): void {
  const enabled = isLexiconV2Enabled();
  const runtimeV2Enabled = isLexiconRuntimeV2Enabled();
  const mode = getLexiconV2IntentMode();
  const worker = getLexiconV2CpuWorkerConfig();
  const model = resolveLexiconIntentModelPath();
  const runtimeV2State = runtimeV2Enabled ? ensureLexiconRuntimeV2Loaded() : undefined;

  console.log('\n[LEXICON_V2] startup contract');
  console.log(`  enabled: ${enabled}`);
  console.log(`  lexiconRuntimeV2.enabled: ${runtimeV2Enabled}`);
  if (runtimeV2State) {
    console.log(`  lexiconRuntimeV2.status: ${runtimeV2State.status}`);
    if (runtimeV2State.tableCounts) {
      console.log(`  lexiconRuntimeV2.tables: ${JSON.stringify(runtimeV2State.tableCounts)}`);
    }
  }
  console.log(`  intentMode: ${mode}`);
  console.log(`  serviceUrl: ${worker.serviceUrl}`);
  console.log(`  modelPath(config): ${model.configuredPath}`);
  console.log(`  modelPath(resolved): ${model.resolvedPath ?? '(missing)'}`);
  console.log(`  modelSource: ${model.source}`);

  if (enabled && !model.exists) {
    logger.warn(
      { configuredPath: model.configuredPath, expectedDir: 'electron-node/models/lexicon-intent/' },
      '[LEXICON_V2] CPU LLM model missing — intent jobs will keep current profile until model is placed'
    );
  }
  console.log('');
}
