import type { Io } from './io';

const PALETTE = [36, 35, 33, 32, 34, 91] as const;

/** Colour only on a terminal or when asked for, and never with NO_COLOR. */
export const wantsColor = (io: Pick<Io, 'env' | 'interactive'>): boolean =>
  io.env.NO_COLOR === undefined && (io.interactive || io.env.FORCE_COLOR !== undefined);

/** Output of several apps on one stream: each line starts with the app's name, in the app's colour. */
export class Prefixer {
  private readonly buffers = new Map<string, string>();
  private readonly width: number;

  constructor(
    private readonly names: readonly string[],
    private readonly color: boolean,
    private readonly out: (text: string) => void,
  ) {
    this.width = Math.max(...names.map((n) => n.length), 4);
  }

  prefix(name: string): string {
    const index = Math.max(0, this.names.indexOf(name));
    const label = name.padEnd(this.width);
    const code = PALETTE[index % PALETTE.length] ?? 36;
    return this.color ? `\u001B[${String(code)}m${label} |\u001B[0m ` : `${label} | `;
  }

  line(name: string, text: string): void {
    this.out(`${this.prefix(name)}${text}`);
  }

  /** Takes a chunk of output; prints each complete line and keeps the rest for the next chunk. */
  feed(name: string, chunk: string): void {
    const lines = ((this.buffers.get(name) ?? '') + chunk).split(/\r?\n/);
    this.buffers.set(name, lines.pop() ?? '');
    for (const line of lines) if (line.trim() !== '') this.line(name, line);
  }

  /** Prints what is left of an unfinished line. */
  flush(name: string): void {
    const rest = this.buffers.get(name) ?? '';
    this.buffers.delete(name);
    if (rest.trim() !== '') this.line(name, rest);
  }
}
