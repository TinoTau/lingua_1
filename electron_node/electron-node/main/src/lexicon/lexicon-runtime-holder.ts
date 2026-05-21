import { LexiconRuntime } from './lexicon-runtime';
import { LexiconRuntimeState } from './lexicon-types';

let runtime: LexiconRuntime | null = null;

export function getLexiconRuntime(): LexiconRuntime {
  if (!runtime) {
    runtime = new LexiconRuntime();
  }
  return runtime;
}

export function ensureLexiconRuntimeLoaded(): LexiconRuntimeState {
  const rt = getLexiconRuntime();
  if (rt.getState().status === 'ok') {
    return rt.getState();
  }
  return rt.load();
}

export function resetLexiconRuntimeForTests(): void {
  if (runtime) {
    runtime.close();
    runtime = null;
  }
}
