export function parseCliArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));

  function readFlag(name) {
    const idx = args.indexOf(`--${name}`);
    if (idx < 0 || idx + 1 >= args.length) {
      return undefined;
    }
    return args[idx + 1];
  }

  return {
    positional,
    strict: flags.has('--strict'),
    skipBuild: flags.has('--skip-build'),
    force: flags.has('--force'),
    input: readFlag('input'),
    output: readFlag('output'),
    registry: readFlag('registry'),
    seed: readFlag('seed'),
    package: readFlag('package'),
    ladder: readFlag('ladder'),
    reviewStatus: readFlag('review-status'),
    patches: readFlag('patches'),
    bundle: readFlag('bundle'),
    report: readFlag('report'),
  };
}
