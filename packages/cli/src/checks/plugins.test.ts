import { describe, expect, it } from 'vitest';
import { importsOf } from './plugins';

describe('importsOf', () => {
  it('finds imports, re-exports, side-effect imports, dynamic imports and requires', () => {
    const code = `
      import a from 'a';
      import { b } from "b";
      import * as c from 'c';
      import d, { e } from 'd';
      export { f } from 'f';
      export * from 'g';
      import 'h';
      const i = await import('i');
      const j = require('j');
      import {
        k,
        l,
      } from 'k';
    `;
    expect(importsOf(code).toSorted((x, y) => x.localeCompare(y))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
    ]);
  });

  it('ignores import type and export type', () => {
    const code = `
      import type { A } from 'react';
      import type React from 'react-dom';
      import type * as T from 'react-router';
      export type { B } from 'i18next';
      export type * from '@mfeflow/theme';
    `;
    expect(importsOf(code)).toEqual([]);
  });

  it('ignores a braced import whose specifiers are all inline types', () => {
    const code = `
      import { type A, type B } from 'react';
      export { type C } from 'react-dom';
      import {
        type D,
        type E,
      } from 'react-router';
    `;
    expect(importsOf(code)).toEqual([]);
  });

  it('keeps an import with at least one value specifier', () => {
    const code = `
      import { type A, b } from 'react';
      import D, { type E } from 'react-dom';
      import {} from 'i18next';
      import type from 'type-fest';
    `;
    expect(importsOf(code).toSorted((x, y) => x.localeCompare(y))).toEqual([
      'i18next',
      'react',
      'react-dom',
      'type-fest',
    ]);
  });

  it('does not let a type export hide the import after it', () => {
    const code = `export type A = 1\nimport { b } from 'react';\n`;
    expect(importsOf(code)).toEqual(['react']);
  });
});
