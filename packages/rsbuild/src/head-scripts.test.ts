import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createShellConfig, headScriptTags, registerHeadScript } from '.';
import { resetHeadScriptsForTests } from './head-scripts';

afterEach(resetHeadScriptsForTests);

describe('registerHeadScript', () => {
  it('turns each script into a head tag that runs before the app', () => {
    registerHeadScript('theme', 'document.documentElement.dataset.theme = "dark"');
    expect(headScriptTags()).toEqual([
      {
        tag: 'script',
        children: 'document.documentElement.dataset.theme = "dark"',
        head: true,
        append: false,
      },
    ]);
  });

  it('replaces a script registered again under the same name, as a config reload does', () => {
    registerHeadScript('theme', 'one');
    registerHeadScript('theme', 'two');
    registerHeadScript('other', 'three');
    expect(headScriptTags().map((tag) => tag.children)).toEqual(['two', 'three']);
  });

  it('has nothing to add when no script was registered', () => {
    expect(headScriptTags()).toEqual([]);
  });
});

describe('createShellConfig with a head script', () => {
  const cwd = path.resolve(import.meta.dirname, '..');

  it('puts the registered scripts in html.tags', () => {
    registerHeadScript('theme', 'run();');
    const tags = createShellConfig({ name: 'shell', cwd }).html?.tags;
    expect(tags).toEqual([{ tag: 'script', children: 'run();', head: true, append: false }]);
  });

  it('leaves html alone when there are none', () => {
    expect(createShellConfig({ name: 'shell', cwd }).html).toBeUndefined();
  });
});
