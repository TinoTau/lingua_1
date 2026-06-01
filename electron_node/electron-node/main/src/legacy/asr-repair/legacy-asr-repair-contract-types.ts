/**
 * @deprecated Legacy Recover-only types.
 * Not part of FW frozen main chain.
 */
export type AsrRepairLifecycle = {
  executed: boolean;
  gated: boolean;
  skipped: boolean;
  skipReason: string | null;
};
