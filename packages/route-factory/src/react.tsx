import type { AnchorHTMLAttributes, MouseEvent, ReactElement } from 'react';
import type { Links } from '.';
import type { LinkId, LinkOptions, RouteSets, TemplateOf } from './types';

export type MfeLinkProps<S extends RouteSets, Id extends LinkId<S>> = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
> & { to: Id } & LinkOptions<TemplateOf<S, Id>>;

export interface MfeLinkConfig {
  /**
   * A hook that returns the router's navigate function, taking a path without the base:
   * `createMfeLink(links, { useNavigate })` with React Router. Without it, a click on a link
   * to this origin pushes the URL and sends `popstate`, which routers that listen to the
   * history pick up (single-spa does the same); other links load the page.
   */
  useNavigate?: () => (path: string) => void;
}

/** Moves to `path` without a page load, and tells whoever listens to the history. */
export function pushPath(path: string): void {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate', { state: null }));
}

type Loose = (id: string, options: unknown) => string;

const opensElsewhere = (event: MouseEvent, target: string | undefined) =>
  event.button !== 0 ||
  event.metaKey ||
  event.ctrlKey ||
  event.shiftKey ||
  event.altKey ||
  (target !== undefined && target !== '_self');

/**
 * An `<a>` that links to a route of any remote, typed from the same definitions as `createLinks`.
 * Left clicks navigate without a page load; middle clicks, modified clicks and `target="_blank"`
 * keep the browser's behaviour.
 *
 * ```tsx
 * const MfeLink = createMfeLink(links);
 * <MfeLink to="catalog.product" params={{ sku: 'A1' }}>Mugs</MfeLink>
 * ```
 */
export function createMfeLink<S extends RouteSets>(
  links: Links<S>,
  config: MfeLinkConfig = {},
): <Id extends LinkId<S>>(props: MfeLinkProps<S, Id>) => ReactElement {
  const useRouterNavigate = config.useNavigate ?? (() => undefined);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the props already carry the right options for `to`
  const href = links.href as Loose;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
  const path = links.path as Loose;
  return function MfeLink({ to, params, search, hash, onClick, children, ...rest }) {
    const navigate = useRouterNavigate();
    const options = { params, search, hash };
    const url = href(to, options);
    return (
      <a
        {...rest}
        href={url}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || opensElsewhere(event, rest.target)) return;
          if (navigate) {
            event.preventDefault();
            navigate(path(to, options));
          } else if (new URL(url, location.href).origin === location.origin) {
            event.preventDefault();
            pushPath(url);
          }
        }}
      >
        {children}
      </a>
    );
  };
}
