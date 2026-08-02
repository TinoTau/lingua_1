import { spawnSync } from 'child_process';

export function runCmd(cmd, args, { cwd, label, env } = {}) {
  const title = label ?? `${cmd} ${args.join(' ')}`;
  console.log(`\n[lexicon] ${title}`);
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: env ?? process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
