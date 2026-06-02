export type ApplyLexiconPatchOptions = {
  /** Apply to this bundle dir instead of configured v3 runtime. */
  bundleDir?: string;
  /** Reload global LexiconRuntimeV2 after apply (default true). */
  reload?: boolean;
};
