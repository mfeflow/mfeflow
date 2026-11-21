import { describe, expect, it } from 'vitest';
import { hashContent } from './hash';

const WORKSPACE = 'packages:\n  - apps/*\ncatalog:\n  react: 19.3.1\n';

describe('hashContent', () => {
  it('ignores line endings', () => {
    expect(hashContent('a\r\nb\r\n')).toBe(hashContent('a\nb\n'));
  });

  it('changes when the content changes', () => {
    expect(hashContent(`${WORKSPACE}x: 1\n`)).not.toBe(hashContent(WORKSPACE));
  });

  it('ignores the minimumReleaseAgeExclude list pnpm appends on the first install', () => {
    const afterInstall = `${WORKSPACE}minimumReleaseAgeExclude:\n  - "@mfeflow/core@0.9.0"\n  - mfeflow@0.9.0\n`;
    expect(hashContent(afterInstall)).toBe(hashContent(WORKSPACE));
  });

  it('ignores the list when other keys follow it', () => {
    const middle =
      'packages:\n  - apps/*\nminimumReleaseAgeExclude:\n  - a@1.0.0\ncatalog:\n  react: 19.3.1\n';
    expect(hashContent(middle)).toBe(
      hashContent('packages:\n  - apps/*\ncatalog:\n  react: 19.3.1\n'),
    );
  });

  it('still sees a real edit made next to the list', () => {
    const edited = `${WORKSPACE}minimumReleaseAgeExclude:\n  - a@1.0.0\nallowBuilds:\n  esbuild: false\n`;
    expect(hashContent(edited)).not.toBe(hashContent(WORKSPACE));
  });
});
