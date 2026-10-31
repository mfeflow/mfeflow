import { describe, expect, it, vi } from 'vitest';
import { processIo } from './io';
import { clackPrompter } from './prompter';
import { realRuntime } from './runtime';

describe('processIo', () => {
  it('writes a line to stdout and to stderr', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const io = processIo();
      io.stdout('hello');
      io.stderr('oops');
      expect(out).toHaveBeenCalledWith('hello\n');
      expect(err).toHaveBeenCalledWith('oops\n');
      expect(io.cwd).toBe(process.cwd());
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});

describe('realRuntime', () => {
  it('wires the process, clack and the checkout assets', () => {
    const rt = realRuntime();
    expect(rt.prompter).toBe(clackPrompter);
    expect(rt.roots.features).toMatch(/features$/);
    expect(typeof rt.system.install).toBe('function');
    expect(typeof rt.fetch).toBe('function');
  });

  it('uses the io it is given', () => {
    const io = processIo();
    expect(realRuntime(io).io).toBe(io);
  });
});
