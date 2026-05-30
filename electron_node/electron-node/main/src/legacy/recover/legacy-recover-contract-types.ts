/**
 * @deprecated Legacy Recover-only types.
 * Not part of FW frozen main chain.
 */
export type RecoverLifecycle = {
  executed: boolean;
  gated: boolean;
  skipped: boolean;
  skipReason: string | null;
};
