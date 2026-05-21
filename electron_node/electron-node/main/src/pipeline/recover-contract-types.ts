export type RecoverLifecycle = {
  executed: boolean;
  gated: boolean;
  skipped: boolean;
  skipReason: string | null;
};
