import { describe, expect, it } from 'vitest';
import { mergeOptions, parseFeatureOptions } from './options';
import { thrown } from './testing';

describe('feature options', () => {
  it('groups feature.key=value flags by feature and types booleans', () => {
    expect(
      parseFeatureOptions(['a.x=1', 'a.y=true', 'b.z=false', 'b.url=https://q.dev/?a=b']),
    ).toEqual({
      a: { x: '1', y: true },
      b: { z: false, url: 'https://q.dev/?a=b' },
    });
  });

  it.each(['nodot=1', 'a.b', '=x', '.b=1', 'a=1.b'])('rejects "%s" with E107', (flag) => {
    expect(thrown(() => parseFeatureOptions([flag])).code).toBe('MFEFLOW_E107');
  });

  it('merges key by key with the later source winning', () => {
    expect(mergeOptions({ a: { x: 1, y: 2 }, b: { z: 1 } }, { a: { y: 3 } })).toEqual({
      a: { x: 1, y: 3 },
      b: { z: 1 },
    });
  });
});
