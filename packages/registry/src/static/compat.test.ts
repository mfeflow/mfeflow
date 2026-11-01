import { describe, expect, it } from 'vitest';
import { comparable, compatProblems, satisfiesRange, sharedOf } from './compat';

describe('comparable', () => {
  it('reads a version or the lowest version a range allows', () => {
    expect(comparable('19.0.0')).toBe('19.0.0');
    expect(comparable('^19.1.0')).toBe('19.1.0');
  });

  it('is undefined for specs that name no version', () => {
    for (const spec of ['workspace:*', 'catalog:', 'link:../x', 'file:../x', 'latest', '', '  ']) {
      expect(comparable(spec)).toBeUndefined();
    }
  });
});

describe('satisfiesRange', () => {
  it('checks a version against a range', () => {
    expect(satisfiesRange('^19.0.0', '19.2.1')).toBe(true);
    expect(satisfiesRange('^19.0.0', '18.3.0')).toBe(false);
  });

  it('passes when there is nothing to compare', () => {
    expect(satisfiesRange('^19.0.0', undefined)).toBe(true);
    expect(satisfiesRange('^19.0.0', 'workspace:*')).toBe(true);
    expect(satisfiesRange('not a range', '1.0.0')).toBe(true);
  });
});

describe('sharedOf', () => {
  it('reads name, version, requiredVersion and singleton, and ignores junk', () => {
    expect(
      sharedOf({
        shared: [
          { name: 'react', version: '19.0.0', requiredVersion: '^19', singleton: true },
          'x',
          { version: '1' },
        ],
      }),
    ).toEqual([{ name: 'react', version: '19.0.0', requiredVersion: '^19', singleton: true }]);
    expect(sharedOf(undefined)).toEqual([]);
    expect(sharedOf({ shared: 'no' })).toEqual([]);
  });
});

describe('compatProblems', () => {
  const remoteManifest = {
    shared: [
      { name: 'react', requiredVersion: '^19.0.0', singleton: true },
      { name: 'lodash', requiredVersion: '^4.0.0', singleton: false },
    ],
  };

  it('only checks singletons', () => {
    const shellManifest = { shared: [{ name: 'lodash', version: '3.0.0' }] };
    expect(compatProblems({ remoteManifest, shellManifest })).toEqual([]);
  });

  it('prefers the shell manifest over workspace versions', () => {
    const shellManifest = { shared: [{ name: 'react', version: '19.1.0' }] };
    expect(
      compatProblems({ remoteManifest, shellManifest, workspaceVersions: { react: '18.0.0' } }),
    ).toEqual([]);
  });

  it('falls back to workspace versions for packages the shell manifest lacks', () => {
    expect(
      compatProblems({
        remoteManifest,
        shellManifest: { shared: [] },
        workspaceVersions: { react: '18.0.0' },
      }),
    ).toEqual([
      { name: 'react', range: '^19.0.0', provided: '18.0.0', source: 'shared', kind: 'mismatch' },
    ]);
  });

  it('does not check a package nobody provides', () => {
    expect(compatProblems({ remoteManifest })).toEqual([]);
  });

  it('checks platform ranges', () => {
    const problems = compatProblems({
      remoteManifest: {},
      platform: { react: '^19' },
      workspaceVersions: { react: '18.2.0' },
    });
    expect(problems).toEqual([
      {
        name: 'react',
        range: '^19',
        provided: '18.2.0',
        source: 'mfe.json platform',
        kind: 'mismatch',
      },
    ]);
  });
});
