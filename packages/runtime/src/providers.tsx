import type { ComponentType, ReactNode } from 'react';

export type ProviderComponent = ComponentType<{ children?: ReactNode }>;

/** Binds props to a provider so it fits in a `composeProviders` list. */
export function withProps<P extends object>(
  Component: ComponentType<P & { children?: ReactNode }>,
  props: P,
): ProviderComponent {
  function WithProps({ children }: { children?: ReactNode }) {
    return <Component {...props}>{children}</Component>;
  }
  WithProps.displayName = `withProps(${Component.displayName ?? Component.name})`;
  return WithProps;
}

/**
 * Nests providers so the first one in the list is the outermost. The shell and
 * `renderWithPlatform` in tests use the same list, so tests see the real platform.
 */
export function composeProviders(providers: readonly ProviderComponent[]): ProviderComponent {
  function ComposedProviders({ children }: { children?: ReactNode }) {
    let tree: ReactNode = children;
    for (let i = providers.length - 1; i >= 0; i--) {
      const Provider = providers[i];
      if (Provider) tree = <Provider>{tree}</Provider>;
    }
    return tree;
  }
  ComposedProviders.displayName = `composeProviders(${String(providers.length)})`;
  return ComposedProviders;
}
