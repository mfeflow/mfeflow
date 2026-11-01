import { describe, expect, it } from 'vitest';
import { judgeRemoteInitial, primaryExpose } from './remote-budget';

describe('primaryExpose', () => {
  it('prefers ./App, else the first expose', () => {
    expect(primaryExpose(['./Cart', './App'])).toBe('./App');
    expect(primaryExpose(['./Cart', './Mini'])).toBe('./Cart');
    expect(primaryExpose([])).toBeUndefined();
  });
});

describe('judgeRemoteInitial', () => {
  const kb = (n: number) => n * 1024;

  it('holds the entry plus the primary expose to the mfe.json budget', () => {
    const pass = judgeRemoteInitial({ entryBytes: kb(5), exposeBytes: kb(3) }, 8);
    expect(pass).toEqual({ kb: 8, totalKb: 8, limitKb: 8, pass: true, source: 'mfe.json' });
    expect(judgeRemoteInitial({ entryBytes: kb(5), exposeBytes: kb(3.5) }, 8).pass).toBe(false);
  });

  it('holds the entry alone to the cost model without a budget', () => {
    expect(judgeRemoteInitial({ entryBytes: kb(9), exposeBytes: kb(50) }, undefined)).toEqual({
      kb: 9,
      totalKb: 59,
      limitKb: 10,
      pass: true,
      source: 'cost-model',
    });
    expect(judgeRemoteInitial({ entryBytes: kb(11), exposeBytes: 0 }, undefined).pass).toBe(false);
  });

  it('takes a project cost model', () => {
    const model = { lcpDeltaMs: 300, shellKb: 32, remoteKb: 2 };
    expect(
      judgeRemoteInitial({ entryBytes: kb(3), exposeBytes: 0 }, undefined, model).limitKb,
    ).toBe(2);
  });
});
