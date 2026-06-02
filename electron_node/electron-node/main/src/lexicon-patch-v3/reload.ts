import {
  ensureLexiconRuntimeV2Loaded,
  resetLexiconRuntimeV2ForTests,
} from '../lexicon-v2/lexicon-runtime-v2-holder';
import type { LexiconRuntimeV2State } from '../lexicon-v2/lexicon-types-v2';

/** V3.1：Patch 后无参热重载（内部仍为 LexiconRuntimeV2.close + load）。 */
export function forceReloadLexiconRuntimeV3(): LexiconRuntimeV2State {
  resetLexiconRuntimeV2ForTests();
  return ensureLexiconRuntimeV2Loaded();
}
