import { cleanup, render, screen } from '@testing-library/react';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { composeProviders, withProps } from './providers';

afterEach(cleanup);

const Order = createContext<string[]>([]);

function Named({ name, children }: { name: string; children?: ReactNode }) {
  const outer = useContext(Order);
  const value = useMemo(() => [...outer, name], [outer, name]);
  return <Order.Provider value={value}>{children}</Order.Provider>;
}

function Outer({ children }: { children?: ReactNode }) {
  return <Named name="outer">{children}</Named>;
}

function Show() {
  return <span data-testid="order">{useContext(Order).join('>')}</span>;
}

describe('composeProviders', () => {
  it('nests providers with the first one outermost', () => {
    const Providers = composeProviders([
      Outer,
      withProps(Named, { name: 'middle' }),
      withProps(Named, { name: 'inner' }),
    ]);
    render(
      <Providers>
        <Show />
      </Providers>,
    );
    expect(screen.getByTestId('order').textContent).toBe('outer>middle>inner');
  });

  it('renders children with an empty list and names components for devtools', () => {
    const Providers = composeProviders([]);
    render(
      <Providers>
        <span data-testid="child">ok</span>
      </Providers>,
    );
    expect(screen.getByTestId('child').textContent).toBe('ok');
    expect(Providers.displayName).toBe('composeProviders(0)');
    expect(withProps(Named, { name: 'x' }).displayName).toBe('withProps(Named)');
  });
});
