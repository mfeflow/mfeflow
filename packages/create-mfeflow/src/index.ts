import { main as mfeflow, type Runtime } from 'mfeflow';
import { readPackageJson } from './version';

/**
 * `npm create mfeflow@latest my-app -- --yes` runs this with `['my-app', '--yes']`.
 * It is `mfeflow init` with the same arguments, so every `init` flag works.
 */
export async function main(argv: readonly string[], runtime?: Runtime): Promise<number> {
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`create-mfeflow ${readPackageJson().version}\n`);
    return 0;
  }
  return runtime ? mfeflow(['init', ...argv], runtime) : mfeflow(['init', ...argv]);
}
