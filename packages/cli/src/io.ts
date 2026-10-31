/** Everything the commands read from or write to the process, so tests can stand in for it. */
export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  /** True when both stdin and stdout are terminals, so prompting makes sense. */
  interactive: boolean;
}

export function processIo(): Io {
  return {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    cwd: process.cwd(),
    env: process.env,
    interactive: process.stdin.isTTY && process.stdout.isTTY,
  };
}
