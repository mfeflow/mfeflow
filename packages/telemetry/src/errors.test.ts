import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectRemoteErrors } from './errors';
import type { ErrorContext } from './types';

const send = (detail: unknown) =>
  window.dispatchEvent(new CustomEvent('mfeflow:remote-error', { detail }));
const report = (mfe: string, where = 'render', message = 'boom') => ({
  mfe,
  where,
  message,
  time: 1,
});

let got: { error: unknown; context: ErrorContext }[] = [];
let stop = () => {};
const collect = (error: unknown, context: ErrorContext) => got.push({ error, context });

beforeEach(() => {
  got = [];
  Reflect.deleteProperty(globalThis, 'mfeflowReports');
});
afterEach(() => {
  stop();
});

describe('connectRemoteErrors', () => {
  it('reports each remote failure with its name and where it happened', () => {
    stop = connectRemoteErrors(collect);
    send(report('cart', 'load', 'timed out after 5000 ms'));
    expect(got).toHaveLength(1);
    expect(got[0]?.context).toEqual({ mfe: 'cart', where: 'load' });
    expect(got[0]?.error).toMatchObject({ message: 'timed out after 5000 ms' });
  });

  it('replays the failures that happened before it connected', () => {
    Reflect.set(globalThis, 'mfeflowReports', [report('catalog', 'registry'), report('cart')]);
    stop = connectRemoteErrors(collect);
    expect(got.map((g) => g.context.mfe)).toEqual(['catalog', 'cart']);
  });

  it('connects once: a second call does not report twice', () => {
    stop = connectRemoteErrors(collect);
    const second = connectRemoteErrors(collect);
    send(report('cart'));
    expect(got).toHaveLength(1);
    second();
    send(report('cart'));
    expect(got).toHaveLength(2);
  });

  it('ignores events that are not reports', () => {
    stop = connectRemoteErrors(collect);
    send(undefined);
    send({ mfe: 3 });
    window.dispatchEvent(new Event('mfeflow:remote-error'));
    expect(got).toEqual([]);
  });

  it('stops after disconnecting, and can connect again', () => {
    connectRemoteErrors(collect)();
    send(report('cart'));
    expect(got).toEqual([]);
    stop = connectRemoteErrors(collect);
    send(report('cart'));
    expect(got).toHaveLength(1);
  });
});
