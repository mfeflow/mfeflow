import { readPackageJson } from './version';

/** Message shown by `npm create mfeflow@latest` until the scaffolder exists. */
export function notReadyText(): string {
  const { version } = readPackageJson();
  return [
    `create-mfeflow ${version}`,
    '',
    'mfeflow is in early development; project creation is not available yet.',
    'Follow along: https://github.com/mfeflow/mfeflow',
  ].join('\n');
}

/** Runs the scaffolder and returns the process exit code. */
export function main(write: (text: string) => void): number {
  write(notReadyText());
  return 1;
}
