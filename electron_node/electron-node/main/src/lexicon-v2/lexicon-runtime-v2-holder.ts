import { LexiconRuntimeV2, markLexiconRuntimeV2Disabled } from './lexicon-runtime-v2';
import { isLexiconRuntimeV2Enabled } from './lexicon-runtime-v2-config';
import type { LexiconRuntimeV2State } from './lexicon-types-v2';

let runtime: LexiconRuntimeV2 | null = null;

export function getLexiconRuntimeV2(): LexiconRuntimeV2 {
  if (!runtime) {
    runtime = new LexiconRuntimeV2();
  }
  return runtime;
}

export function ensureLexiconRuntimeV2Loaded(): LexiconRuntimeV2State {
  if (!isLexiconRuntimeV2Enabled()) {
    return markLexiconRuntimeV2Disabled();
  }
  const rt = getLexiconRuntimeV2();
  if (rt.getState().status === 'ok') {
    return rt.getState();
  }
  return rt.load();
}

export function resetLexiconRuntimeV2ForTests(): void {
  if (runtime) {
    runtime.close();
    runtime = null;
  }
}
