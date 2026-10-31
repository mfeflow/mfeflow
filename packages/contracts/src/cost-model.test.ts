import { describe, expect, it } from 'vitest';
import { COST_MODEL, judgeCost, round1, splitScripts } from './cost-model';

const KB = 1024;

describe('judgeCost', () => {
  it('passes a route inside every budget', () => {
    const verdict = judgeCost({
      shellBytes: 120 * KB,
      monolithBytes: 94 * KB,
      remoteBytes: { catalog: 9.6 * KB, cart: 9.6 * KB },
      lcpDeltaMs: 160,
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.shell).toEqual({ budget: 32, actual: 26, pass: true });
    expect(verdict.remotes.map((r) => r.name)).toEqual(['cart', 'catalog']);
    expect(verdict.lcp.pass).toBe(true);
  });

  it('fails when the shell adds more than its budget', () => {
    const verdict = judgeCost({
      shellBytes: 130 * KB,
      monolithBytes: 94 * KB,
      remoteBytes: {},
      lcpDeltaMs: 0,
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.shell.pass).toBe(false);
    expect(verdict.shell.actual).toBe(36);
  });

  it('fails when one remote is over, and says which', () => {
    const verdict = judgeCost({
      shellBytes: 100 * KB,
      monolithBytes: 94 * KB,
      remoteBytes: { catalog: 9 * KB, cart: 10.5 * KB },
      lcpDeltaMs: 10,
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.remotes.find((r) => r.name === 'cart')?.pass).toBe(false);
    expect(verdict.remotes.find((r) => r.name === 'catalog')?.pass).toBe(true);
  });

  it('fails on LCP alone, and a negative delta is fine', () => {
    const base = { shellBytes: 0, monolithBytes: 0, remoteBytes: {} };
    expect(judgeCost({ ...base, lcpDeltaMs: 301 }).pass).toBe(false);
    expect(judgeCost({ ...base, lcpDeltaMs: 300 }).pass).toBe(true);
    expect(judgeCost({ ...base, lcpDeltaMs: -40 }).pass).toBe(true);
  });

  it('takes a model from the project', () => {
    const sample = {
      shellBytes: 110 * KB,
      monolithBytes: 94 * KB,
      remoteBytes: { cart: 9 * KB },
      lcpDeltaMs: 100,
    };
    expect(judgeCost(sample).pass).toBe(true);
    expect(judgeCost(sample, { ...COST_MODEL, shellKb: 10 }).pass).toBe(false);
  });
});

describe('splitScripts', () => {
  it('sums scripts by where they came from and ignores everything else', () => {
    const split = splitScripts([
      { path: '/static/js/index.js', type: 'Script', bytes: 100 },
      { path: '/static/js/lib.js', type: 'Script', bytes: 50 },
      { path: '/mfe/cart/cart.js', type: 'Script', bytes: 8 },
      { path: '/mfe/cart/static/js/App.js', type: 'Script', bytes: 2 },
      { path: '/mfe/catalog/catalog.js', type: 'Script', bytes: 9 },
      { path: '/mfe/cart/mf-manifest.json', type: 'Fetch', bytes: 700 },
      { path: '/static/css/app.css', type: 'Stylesheet', bytes: 40 },
    ]);
    expect(split).toEqual({ shellBytes: 150, remoteBytes: { cart: 10, catalog: 9 } });
  });

  it('is empty for no requests', () => {
    expect(splitScripts([])).toEqual({ shellBytes: 0, remoteBytes: {} });
  });
});

describe('round1', () => {
  it('rounds to one decimal', () => {
    expect(round1(1.04)).toBe(1);
    expect(round1(1.05)).toBe(1.1);
    expect(round1(-0.26)).toBe(-0.3);
    expect(round1(12)).toBe(12);
  });
});
