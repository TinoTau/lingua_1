let chain: Promise<void> = Promise.resolve();

export async function withLexiconPatchLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function resetLexiconPatchLockForTests(): void {
  chain = Promise.resolve();
}
