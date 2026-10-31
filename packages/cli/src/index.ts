import { readPackageJson } from './version';

export const DOCS_URL = 'https://mfeflow.dev';
export const REPO_URL = 'https://github.com/mfeflow/mfeflow';

/** Text printed for `mfeflow --version`. */
export function versionText(): string {
  return `mfeflow ${readPackageJson().version}`;
}

/** Text printed for `mfeflow` and `mfeflow --help` until the CLI exists. */
export function helpText(): string {
  return [
    versionText(),
    '',
    'mfeflow is in early development and has no commands yet.',
    `Follow along: ${REPO_URL}`,
    `Docs: ${DOCS_URL}`,
  ].join('\n');
}

/** Runs the CLI and returns the process exit code. */
export function main(argv: readonly string[], write: (text: string) => void): number {
  const [first] = argv;
  if (first === '--version' || first === '-v') {
    write(versionText());
    return 0;
  }
  if (first === undefined || first === '--help' || first === '-h') {
    write(helpText());
    return 0;
  }
  write(`Unknown command: ${first}\n\n${helpText()}`);
  return 1;
}
