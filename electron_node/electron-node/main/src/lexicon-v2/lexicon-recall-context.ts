/**
 * Phase 4 — thread-local session intent for recall (orchestrator sets, local-span-recall reads).
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { LexiconSessionIntent } from '../session-runtime/types';

export type LexiconRecallContext = {
  sessionIntent?: LexiconSessionIntent;
};

const storage = new AsyncLocalStorage<LexiconRecallContext>();

export function runWithLexiconRecallContext<T>(
  context: LexiconRecallContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return storage.run(context, fn);
}

export function getLexiconRecallContext(): LexiconRecallContext | undefined {
  return storage.getStore();
}
