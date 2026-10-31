import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { killTree, portFree, spawnDev, watchPaths, type TreeKiller } from './proc';
import net from 'node:net';

const killer = (overrides: Partial<TreeKiller>): TreeKiller => ({
  platform: 'linux',
  kill: () => undefined,
  taskkill: () => Promise.resolve(),
  graceMs: 20,
  ...overrides,
});

describe('killTree', () => {
  it('uses taskkill /T on Windows', async () => {
    const calls: number[] = [];
    await killTree(
      42,
      killer({ platform: 'win32', taskkill: (pid) => (calls.push(pid), Promise.resolve()) }),
    );
    expect(calls).toEqual([42]);
  });

  it('sends SIGTERM to the process group and stops once it is gone', async () => {
    const sent: [number, string | number][] = [];
    let gone = false;
    await killTree(
      7,
      killer({
        kill: (pid, signal) => {
          sent.push([pid, signal]);
          if (signal === 'SIGTERM') gone = true;
          if (signal === 0 && gone) throw new Error('ESRCH');
        },
      }),
    );
    expect(sent[0]).toEqual([-7, 'SIGTERM']);
    expect(sent.some(([, s]) => s === 'SIGKILL')).toBe(false);
  });

  it('escalates to SIGKILL when the group ignores SIGTERM', async () => {
    const sent: (string | number)[] = [];
    let dead = false;
    await killTree(
      7,
      killer({
        kill: (_pid, signal) => {
          sent.push(signal);
          if (signal === 'SIGKILL') dead = true;
          if (signal === 0 && dead) throw new Error('ESRCH');
        },
      }),
    );
    expect(sent).toContain('SIGTERM');
    expect(sent).toContain('SIGKILL');
  });

  it('returns when the group is already gone', async () => {
    await killTree(
      7,
      killer({
        kill: () => {
          throw new Error('ESRCH');
        },
      }),
    );
  });
});

const posix = process.platform === 'win32' ? it.skip : it;

describe('spawnDev', () => {
  posix(
    'stops a process and the child it started',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-proc-'));
      const pidFile = path.join(dir, 'child.pid');
      const script = `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
      console.log('up');
      setInterval(() => {}, 1000);
    `;
      const proc = spawnDev({ command: process.execPath, args: ['-e', script], cwd: dir, env: {} });
      let output = '';
      proc.onOutput((chunk) => {
        output += chunk;
      });
      const exited = new Promise<number | null>((resolve) => proc.onExit(resolve));
      for (let i = 0; i < 200 && !(output.includes('up') && fs.existsSync(pidFile)); i++) {
        // oxlint-disable-next-line no-await-in-loop -- polling
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
      expect(() => process.kill(grandchild, 0)).not.toThrow();
      await proc.stop();
      await exited;
      expect(() => process.kill(grandchild, 0)).toThrow();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    15_000,
  );

  it('reports the exit code and a command that cannot start', async () => {
    const ok = spawnDev({
      command: process.execPath,
      args: ['-e', 'process.exit(3)'],
      cwd: os.tmpdir(),
      env: {},
    });
    expect(await new Promise((resolve) => ok.onExit(resolve))).toBe(3);
    const missing = spawnDev({
      command: 'no-such-program-mfeflow',
      args: [],
      cwd: os.tmpdir(),
      env: {},
    });
    expect(await new Promise((resolve) => missing.onExit(resolve))).toBeDefined();
  });
});

describe('portFree', () => {
  it('is false while something listens and true after', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as net.AddressInfo;
    expect(await portFree(port)).toBe(false);
    await new Promise((resolve) => server.close(resolve));
    expect(await portFree(port)).toBe(true);
  });
});

describe('watchPaths', () => {
  it('fires once for a burst of changes to a watched file, and not for its neighbours', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-watch-'));
    const file = path.join(dir, 'mfeflow.json');
    fs.writeFileSync(file, '{}');
    // FSEvents on macOS replays events from just before the watch started.
    await new Promise((resolve) => setTimeout(resolve, 300));
    let fired = 0;
    const stop = watchPaths([file, path.join(dir, 'missing')], () => {
      fired += 1;
    });
    fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fired).toBe(0);
    fs.writeFileSync(file, '{"a":1}');
    fs.renameSync(file, `${file}.old`);
    fs.writeFileSync(file, '{"a":2}');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fired).toBe(1);
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('watches a folder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-watch-'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    let fired = 0;
    const stop = watchPaths([dir], () => {
      fired += 1;
    });
    fs.writeFileSync(path.join(dir, 'a.json'), '{}');
    await new Promise((resolve) => setTimeout(resolve, 500));
    stop();
    expect(fired).toBeGreaterThanOrEqual(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
