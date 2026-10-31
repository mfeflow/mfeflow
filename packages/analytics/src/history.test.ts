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
    expect(seen).toEqual(['/a', '/b?x=1', '/b?x=1']);
    stop();
  });

  it('keeps the query but drops personal data and secrets, and never the hash', () => {
    const seen: string[] = [];
    const stop = onNavigate((path) => seen.push(path));
    history.pushState(
      null,
      '',
      '/q?utm_source=mail&gclid=g1&token=abc&email=a%40b.com&ref=x%40y.zz&access_token=t&page=2#frag',
    );
    expect(seen).toEqual(['/q?utm_source=mail&gclid=g1&page=2']);
    stop();
  });

  it('treats the same path with another query as another page', () => {
    const seen: string[] = [];
    const stop = onNavigate((path) => seen.push(path));
    history.pushState(null, '', '/list?page=1');
    history.pushState(null, '', '/list?page=2');
    expect(seen).toEqual(['/list?page=1', '/list?page=2']);
    stop();
  });

  it('follows hash routers', () => {
    const seen: string[] = [];
    const stop = onNavigate((path) => seen.push(path));
    history.pushState(null, '', '/#/catalog?token=abc&sort=asc');
    dispatchEvent(new HashChangeEvent('hashchange'));
    expect(seen).toEqual(['/#/catalog?sort=asc', '/#/catalog?sort=asc']);
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
