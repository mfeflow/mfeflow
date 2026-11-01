import { describe, expect, it } from 'vitest';
import { remoteDistFiles } from './remote-dist';

const manifest = (publicPath = 'auto') => ({
  metaData: {
    publicPath,
    globalName: 'cart',
    remoteEntry: { name: 'remoteEntry.js', path: 'static/js', type: 'global' },
  },
  exposes: [
    {
      path: './App',
      assets: {
        js: { sync: ['static/js/App.js', 'static/js/vendor.mjs'] },
        css: { sync: ['static/css/App.css'] },
      },
    },
  ],
});

describe('remoteDistFiles', () => {
  it('lists the entry and each expose scripts as paths inside the build folder, without CSS', () => {
    expect(remoteDistFiles(manifest())).toEqual({
      entry: 'static/js/remoteEntry.js',
      exposes: { './App': ['static/js/App.js', 'static/js/vendor.mjs'] },
    });
  });

  it('ignores where the files are served from', () => {
    expect(remoteDistFiles(manifest('https://cdn.example.com/cart/'))?.entry).toBe(
      'static/js/remoteEntry.js',
    );
    expect(remoteDistFiles(manifest('/mfe/cart/'))?.exposes['./App']).toHaveLength(2);
  });

  it('is undefined for anything that is not a usable manifest', () => {
    expect(remoteDistFiles(undefined)).toBeUndefined();
    expect(remoteDistFiles({})).toBeUndefined();
    expect(remoteDistFiles({ metaData: { remoteEntry: {} } })).toBeUndefined();
  });
});
