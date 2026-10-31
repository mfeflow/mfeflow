import { afterEach, describe, expect, it } from 'vitest';
import { onNavigate } from './history';

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('onNavigate', () => {
  it('reports pushState, replaceState and back/forward', () => {
    const seen: string[] = [];
    const stop = onNavigate((path) => seen.push(path));
    history.pushState(null, '', '/a');
    history.replaceState(null, '', '/b?x=1');
    dispatchEvent(new PopStateEvent('popstate'));
    expect(seen).toEqual(['/a', '/b', '/b']);
    stop();
  });

  it('stops reporting after unsubscribe', () => {
    const seen: string[] = [];
    onNavigate((path) => seen.push(path))();
    history.pushState(null, '', '/c');
    expect(seen).toEqual([]);
  });

  it('patches history once however many listeners there are', () => {
    const a: string[] = [];
    const b: string[] = [];
    const stopA = onNavigate((p) => a.push(p));
    const stopB = onNavigate((p) => b.push(p));
    history.pushState(null, '', '/d');
    expect(a).toEqual(['/d']);
    expect(b).toEqual(['/d']);
    stopA();
    stopB();
  });

  it('keeps pushState working as before', () => {
    const stop = onNavigate(() => {});
    history.pushState({ n: 1 }, '', '/e');
    expect(history.state).toEqual({ n: 1 });
    expect(location.pathname).toBe('/e');
    stop();
  });
});
