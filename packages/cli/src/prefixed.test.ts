import { describe, expect, it } from 'vitest';
import { Prefixer, wantsColor } from './prefixed';

function make(color = false) {
  const lines: string[] = [];
  return { lines, prefixer: new Prefixer(['shell', 'catalog'], color, (t) => lines.push(t)) };
}

describe('Prefixer', () => {
  it('pads every name to the longest, at least four wide', () => {
    const { prefixer } = make();
    expect(prefixer.prefix('shell')).toBe('shell   | ');
    expect(prefixer.prefix('catalog')).toBe('catalog | ');
    expect(new Prefixer(['a'], false, () => undefined).prefix('a')).toBe('a    | ');
  });

  it('colours the name by its place in the list', () => {
    const { prefixer } = make(true);
    expect(prefixer.prefix('shell')).toBe('\u001B[36mshell   |\u001B[0m ');
    expect(prefixer.prefix('catalog')).toBe('\u001B[35mcatalog |\u001B[0m ');
  });

  it('prints whole lines and holds a partial one until it is finished', () => {
    const { prefixer, lines } = make();
    prefixer.feed('shell', 'one\r\ntw');
    prefixer.feed('shell', 'o\n\n  \nthree');
    expect(lines).toEqual(['shell   | one', 'shell   | two']);
    prefixer.flush('shell');
    expect(lines.at(-1)).toBe('shell   | three');
    prefixer.flush('shell');
    expect(lines).toHaveLength(3);
  });

  it('keeps each app`s partial line apart', () => {
    const { prefixer, lines } = make();
    prefixer.feed('shell', 'a');
    prefixer.feed('catalog', 'b\n');
    prefixer.feed('shell', 'c\n');
    expect(lines).toEqual(['catalog | b', 'shell   | ac']);
  });
});

describe('wantsColor', () => {
  it('is on for a terminal or FORCE_COLOR, and never with NO_COLOR', () => {
    expect(wantsColor({ env: {}, interactive: true })).toBe(true);
    expect(wantsColor({ env: {}, interactive: false })).toBe(false);
    expect(wantsColor({ env: { FORCE_COLOR: '1' }, interactive: false })).toBe(true);
    expect(wantsColor({ env: { NO_COLOR: '1' }, interactive: true })).toBe(false);
  });
});
