import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLinks, defineRoutes } from '.';
import { createMfeLink, pushPath } from './react';

const links = createLinks(
  {
    catalog: defineRoutes('/catalog', { product: '/products/:sku', home: '/' }),
    cart: defineRoutes('/cart', { home: '/' }),
  },
  { base: '/app' },
);

beforeEach(() => {
  history.replaceState(null, '', '/');
});
afterEach(cleanup);

describe('createMfeLink', () => {
  it('renders the href under the base', () => {
    const MfeLink = createMfeLink(links);
    render(
      <MfeLink to="catalog.product" params={{ sku: 'A1' }} className="x">
        Mug
      </MfeLink>,
    );
    const a = screen.getByRole('link', { name: 'Mug' });
    expect(a.getAttribute('href')).toBe('/app/catalog/products/A1');
    expect(a.className).toBe('x');
  });

  it('navigates without a page load by default, telling listeners', () => {
    const MfeLink = createMfeLink(links);
    const onPop = vi.fn();
    addEventListener('popstate', onPop);
    render(<MfeLink to="cart.home">Cart</MfeLink>);
    const notPrevented = fireEvent.click(screen.getByRole('link'));
    removeEventListener('popstate', onPop);
    expect(notPrevented).toBe(false);
    expect(location.pathname).toBe('/app/cart');
    expect(onPop).toHaveBeenCalledOnce();
  });

  it("hands the router's navigate function the path without the base", () => {
    const navigate = vi.fn();
    const MfeLink = createMfeLink(links, { useNavigate: () => navigate });
    render(<MfeLink to="catalog.home">Catalog</MfeLink>);
    fireEvent.click(screen.getByRole('link'));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/catalog');
    expect(location.pathname).toBe('/');
  });

  it.each([
    ['a modified click', { ctrlKey: true }],
    ['a meta click', { metaKey: true }],
    ['a shift click', { shiftKey: true }],
    ['a middle click', { button: 1 }],
  ])('leaves %s to the browser', (_name, init) => {
    const navigate = vi.fn();
    const MfeLink = createMfeLink(links, { useNavigate: () => navigate });
    render(<MfeLink to="cart.home">Cart</MfeLink>);
    const link = screen.getByRole('link');
    link.addEventListener('click', (e) => {
      e.preventDefault();
    });
    fireEvent.click(link, init);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves target=_blank to the browser', () => {
    const navigate = vi.fn();
    const MfeLink = createMfeLink(links, { useNavigate: () => navigate });
    render(
      <MfeLink to="cart.home" target="_blank">
        Cart
      </MfeLink>,
    );
    fireEvent.click(screen.getByRole('link'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lets onClick cancel the navigation', () => {
    const navigate = vi.fn();
    const MfeLink = createMfeLink(links, { useNavigate: () => navigate });
    render(
      <MfeLink
        to="cart.home"
        onClick={(e) => {
          e.preventDefault();
        }}
      >
        Cart
      </MfeLink>,
    );
    fireEvent.click(screen.getByRole('link'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('is checked like createLinks', () => {
    const MfeLink = createMfeLink(links);
    // @ts-expect-error product needs its sku
    const missing = <MfeLink to="catalog.product">x</MfeLink>;
    // @ts-expect-error no such route
    const unknown = <MfeLink to="catalog.nope">x</MfeLink>;
    expect([missing, unknown]).toHaveLength(2);
  });
});

describe('pushPath', () => {
  it('changes the URL and sends popstate', () => {
    const onPop = vi.fn();
    addEventListener('popstate', onPop);
    pushPath('/somewhere?x=1');
    removeEventListener('popstate', onPop);
    expect(location.pathname + location.search).toBe('/somewhere?x=1');
    expect(onPop).toHaveBeenCalledOnce();
  });
});
