import { describe, expect, it } from 'vitest';
import { renderTemplate, substitute } from './templates.js';

describe('renderTemplate (eta)', () => {
  it('renders values and conditionals', () => {
    const out = renderTemplate(
      'name=<%= it.name %>\n<% if (it.debug) { _%>\ndebug on\n<% } _%>\ndone',
      {
        name: 'shell',
        debug: true,
      },
    );
    expect(out).toBe('name=shell\ndebug on\ndone');
  });

  it('does not HTML-escape source code', () => {
    expect(renderTemplate('<%= it.code %>', { code: "a < b && 'c'" })).toBe("a < b && 'c'");
  });

  it('turns template errors into E209', () => {
    expect(() => renderTemplate('<%= it.a.b.c %>', {}, 'x.eta')).toThrowError(
      expect.objectContaining({ code: 'MFEFLOW_E209' }),
    );
    expect(() => renderTemplate('<% if ( %>', {})).toThrowError(
      expect.objectContaining({ code: 'MFEFLOW_E209' }),
    );
  });
});

describe('substitute (no evaluation)', () => {
  it('replaces names and dotted paths', () => {
    expect(
      substitute('{{ scope }}/{{app.name}} {{n}} {{ok}}', {
        scope: '@a',
        app: { name: 'cart' },
        n: 3,
        ok: true,
      }),
    ).toBe('@a/cart 3 true');
  });

  it('never evaluates code', () => {
    Reflect.deleteProperty(globalThis, 'pwned');
    const source = '<%= globalThis.pwned = 1 %> ${globalThis.pwned = 1} {{ globalThis.pwned = 1 }}';
    expect(substitute(source, {})).toBe(source);
    expect(Reflect.get(globalThis, 'pwned')).toBeUndefined();
  });

  it('fails on a name with no value', () => {
    expect(() => substitute('{{missing}}', {}, 'f.ts')).toThrowError(
      expect.objectContaining({ code: 'MFEFLOW_E209' }),
    );
    expect(() => substitute('{{a.b}}', { a: 'str' })).toThrowError(
      expect.objectContaining({ code: 'MFEFLOW_E209' }),
    );
    expect(() => substitute('{{a}}', { a: { x: 1 } })).toThrowError(
      expect.objectContaining({ code: 'MFEFLOW_E209' }),
    );
  });
});
