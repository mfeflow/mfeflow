import { describe, expect, it } from 'vitest';
import { thrown } from '../testing';
import { addRoute } from './add-route';

const table = `import { Home } from './Home';

export const routes = [
  { path: '/', Component: Home },
];
`;

const run = (source: string, extra: object = {}) =>
  addRoute(source, 'route-table.ts', {
    op: 'add-route',
    file: 'route-table.ts',
    path: '/cart',
    component: 'CartPage',
    from: './CartPage',
    ...extra,
  });

describe('add-route', () => {
  it('adds the route and imports the component', () => {
    expect(run(table)).toBe(`import { Home } from './Home';
import { CartPage } from './CartPage';

export const routes = [
  { path: '/', Component: Home },
  { path: '/cart', Component: CartPage },
];
`);
  });

  it('supports default imports and a differently named array', () => {
    const source = `export const appRoutes = [];\n`;
    const out = run(source, { defaultImport: true, routes: 'appRoutes' });
    expect(out).toContain("import CartPage from './CartPage';");
    expect(out).toContain("appRoutes = [{ path: '/cart', Component: CartPage }]");
  });

  it('is idempotent and notices an existing path', () => {
    const once = run(table);
    expect(run(once)).toBe(once);
    expect(run(table, { path: '/' })).toBe(
      table.replace(
        "import { Home } from './Home';",
        "import { Home } from './Home';\nimport { CartPage } from './CartPage';",
      ),
    );
  });

  it('fails with E208 when the routes array is missing', () => {
    expect(thrown(() => run('export const other = 1;\n')).code).toBe('MFEFLOW_E208');
  });
});
