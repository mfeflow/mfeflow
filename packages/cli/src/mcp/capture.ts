import { realRuntime, type Runtime } from '../runtime';

export type CliMain = (argv: readonly string[], rt: Runtime) => Promise<number>;

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  /** What `--json` printed on stdout; undefined when stdout was not one JSON document. */
  json: unknown;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Runs the CLI's own `main` in this process with its output captured, never a child process. */
export async function runCli(
  main: CliMain,
  argv: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  guardFetch?: (url: string) => void,
): Promise<CliRun> {
  const out: string[] = [];
  const err: string[] = [];
  const base = realRuntime({
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    cwd,
    env,
    interactive: false,
  });
  const rt: Runtime = guardFetch
    ? {
        ...base,
        fetch: (url, init) => {
          guardFetch(url);
          return base.fetch(url, init);
        },
      }
    : base;
  const code = await main(argv, rt);
  const stdout = out.join('\n');
  return { code, stdout, stderr: err.join('\n'), json: parse(stdout) };
}
