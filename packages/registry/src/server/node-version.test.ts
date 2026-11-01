import { describe, expect, it } from 'vitest';
import { assertSqliteSupport, sqliteSupport } from './node-version';
import { openSqliteStorage } from './sqlite';

describe('sqliteSupport', () => {
  it.each([
    ['22.12.0', false],
    ['22.12.9', false],
    ['22.13.0', true],
    ['22.23.4', true],
    ['23.3.0', false],
    ['23.4.0', true],
    ['24.0.0', true],
    ['26.1.2', true],
    ['20.18.0', false],
    ['v22.13.0', true],
    ['v22.12.0', false],
    ['not-a-version', false],
  ])('Node %s: %s', (version, ok) => {
    expect(sqliteSupport(version).ok).toBe(ok);
  });

  it('says what to do and which version is running', () => {
    const { message } = sqliteSupport('22.12.0');
    expect(message).toContain('Node 22.13');
    expect(message).toContain('--experimental-sqlite');
    expect(message).toContain('this is Node 22.12.0');
    expect(sqliteSupport('v22.12.0').message).toContain('this is Node 22.12.0');
  });
});

describe('assertSqliteSupport', () => {
  it('throws the message on an old Node and passes on this one', () => {
    expect(() => assertSqliteSupport('22.12.0')).toThrow(/needs Node 22.13/);
    expect(() => assertSqliteSupport()).not.toThrow();
  });

  it('stops storage before node:sqlite is touched', async () => {
    await expect(openSqliteStorage(':memory:', { nodeVersion: '22.12.0' })).rejects.toThrow(
      /needs Node 22.13/,
    );
    await expect(openSqliteStorage(':memory:', { nodeVersion: '23.3.9' })).rejects.toThrow(
      /Upgrade Node/,
    );
  });
});
