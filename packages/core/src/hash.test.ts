import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashContent, hashTracked, withoutPnpmWrittenKeys } from './hash';

const WORKSPACE = 'packages:\n  - apps/*\ncatalog:\n  react: 19.3.1\n';
const FILE = 'pnpm-workspace.yaml';
const sha = (text: string) => `sha256-${createHash('sha256').update(text).digest('hex')}`;

describe('hashContent', () => {
  it('ignores line endings', () => {
    expect(hashContent('a\r\nb\r\n')).toBe(hashContent('a\nb\n'));
  });

  it('changes when the content changes', () => {
    expect(hashContent(`${WORKSPACE}x: 1\n`)).not.toBe(hashContent(WORKSPACE));
  });

  it('is the plain sha256 of the text, also when it mentions minimumReleaseAgeExclude', () => {
    expect(hashContent(WORKSPACE)).toBe(sha(WORKSPACE));
    const withKey = `${WORKSPACE}minimumReleaseAgeExclude:\n  - a@1.0.0\n`;
    expect(hashContent(withKey)).toBe(sha(withKey));
    expect(hashContent(withKey)).not.toBe(hashContent(WORKSPACE));
  });
});

describe('hashTracked', () => {
  it('hashes any other file exactly like hashContent', () => {
    const text = `${WORKSPACE}minimumReleaseAgeExclude:\n  - a@1.0.0\n`;
    expect(hashTracked('README.md', text)).toBe(hashContent(text));
    expect(hashTracked('docs/pnpm-workspace.yaml.bak', text)).toBe(hashContent(text));
  });

  it('hashes a workspace file without the key exactly as before', () => {
    expect(hashTracked(FILE, WORKSPACE)).toBe(sha(WORKSPACE));
    expect(hashTracked(FILE, WORKSPACE.replaceAll('\n', '\r\n'))).toBe(sha(WORKSPACE));
  });

  it('matches the workspace file at any depth, with either separator', () => {
    const text = `${WORKSPACE}minimumReleaseAgeExclude:\n  - a@1.0.0\n`;
    expect(hashTracked('sub/dir/pnpm-workspace.yaml', text)).toBe(sha(WORKSPACE));
    expect(hashTracked('sub\\pnpm-workspace.yaml', text)).toBe(sha(WORKSPACE));
  });

  it('ignores the list pnpm appends on the first install', () => {
    const text = `${WORKSPACE}minimumReleaseAgeExclude:\n  - "@mfeflow/core@0.9.0"\n  - mfeflow@0.9.0\n`;
    expect(hashTracked(FILE, text)).toBe(sha(WORKSPACE));
  });

  it('still sees a real edit made next to the list', () => {
    const edited = `${WORKSPACE}minimumReleaseAgeExclude:\n  - a@1.0.0\nallowBuilds:\n  esbuild: false\n`;
    expect(hashTracked(FILE, edited)).not.toBe(sha(WORKSPACE));
  });
});

describe('withoutPnpmWrittenKeys', () => {
  const strip = withoutPnpmWrittenKeys;

  it('returns content without the key untouched', () => {
    expect(strip(WORKSPACE)).toBe(WORKSPACE);
    expect(strip('# minimumReleaseAgeExclude: mentioned\na: 1\n')).toBe(
      '# minimumReleaseAgeExclude: mentioned\na: 1\n',
    );
  });

  it('drops the list when other keys follow it', () => {
    expect(strip('packages:\n  - a\nminimumReleaseAgeExclude:\n  - x\ncatalog:\n  r: 1\n')).toBe(
      'packages:\n  - a\ncatalog:\n  r: 1\n',
    );
  });

  it('drops a same-indent block sequence', () => {
    expect(strip('a: 1\nminimumReleaseAgeExclude:\n- x\n- y\nb: 2\n')).toBe('a: 1\nb: 2\n');
  });

  it('drops blank lines inside the block and keeps the blank before the next key', () => {
    expect(strip('a: 1\nminimumReleaseAgeExclude:\n  - x\n\n  - y\n\nb: 2\n')).toBe(
      'a: 1\n\nb: 2\n',
    );
  });

  it('drops blank lines before a key at the end of the file', () => {
    expect(strip('a: 1\n\nminimumReleaseAgeExclude:\n  - x\n')).toBe('a: 1\n');
    expect(strip('a: 1\nminimumReleaseAgeExclude:\n  - x\n\n\n')).toBe('a: 1\n');
  });

  it('drops a flow list on one line or across lines', () => {
    expect(strip('a: 1\nminimumReleaseAgeExclude: [x, y]\nb: 2\n')).toBe('a: 1\nb: 2\n');
    expect(strip('a: 1\nminimumReleaseAgeExclude: []\n')).toBe('a: 1\n');
    expect(strip('a: 1\nminimumReleaseAgeExclude: [x,\n  y]\nb: 2\n')).toBe('a: 1\nb: 2\n');
  });

  it('drops a trailing comment on the key line', () => {
    expect(strip('a: 1\nminimumReleaseAgeExclude: # by pnpm\n  - x\n')).toBe('a: 1\n');
  });

  it('keeps the previous line break when the file has no trailing newline', () => {
    expect(strip('a: 1\nminimumReleaseAgeExclude:\n  - x')).toBe('a: 1\n');
    expect(strip('a: 1\nminimumReleaseAgeExclude: [x]')).toBe('a: 1\n');
  });

  it('does not touch an indented key of the same name', () => {
    const nested = 'x:\n  minimumReleaseAgeExclude:\n    - a\n';
    expect(strip(nested)).toBe(nested);
  });
});
