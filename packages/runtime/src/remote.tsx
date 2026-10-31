import {
  Component,
  lazy,
  Suspense,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { loadRemote } from '@module-federation/enhanced/runtime';
import { reportRemoteError } from './report';

export interface FallbackProps {
  /** Remote name, e.g. `cart`. */
  name: string;
}

export function DefaultRemoteFallback({ name }: FallbackProps) {
  return (
    <div role="alert" data-mfeflow-fallback={name}>
      {name} is unavailable right now.
    </div>
  );
}

export interface RemoteOptions {
  /** Give up and show the fallback after this long. Module Federation has no timeout of its own. Default 5000. */
  timeoutMs?: number | undefined;
  fallback?: ComponentType<FallbackProps> | undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(ms)} ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function hasDefaultComponent(mod: unknown): mod is { default: ComponentType } {
  return (
    typeof mod === 'object' && mod !== null && 'default' in mod && typeof mod.default === 'function'
  );
}

const cache = new Map<string, ComponentType>();

/**
 * A lazy component for `remote/expose` (e.g. `cart/App`). It never throws: load
 * failures and timeouts render the fallback and are reported. Cached per id.
 */
export function remoteComponent(id: string, options: RemoteOptions = {}): ComponentType {
  const hit = cache.get(id);
  if (hit) return hit;
  const name = id.split('/')[0] ?? id;
  const Fallback = options.fallback ?? DefaultRemoteFallback;
  const C = lazy(async () => {
    try {
      const mod = await withTimeout(loadRemote(id), options.timeoutMs ?? 5000);
      if (!hasDefaultComponent(mod)) throw new Error(`${id} has no default export component`);
      return { default: mod.default };
    } catch (error) {
      reportRemoteError(name, 'load', error);
      cache.delete(id);
      return {
        default: function RemoteFallback() {
          return <Fallback name={name} />;
        },
      };
    }
  });
  cache.set(id, C);
  return C;
}

interface BoundaryProps {
  name: string;
  fallback: ComponentType<FallbackProps>;
  children: ReactNode;
}

class RemoteErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    reportRemoteError(this.props.name, 'render', error);
  }

  override render(): ReactNode {
    const Fallback = this.props.fallback;
    return this.state.failed ? <Fallback name={this.props.name} /> : this.props.children;
  }
}

export interface RemoteBoundaryProps extends RemoteOptions {
  /** `remote/expose`, e.g. `cart/App`. */
  id: string;
  /** Shown while the remote loads. */
  loading?: ReactNode | undefined;
}

/**
 * Renders a remote module. A missing manifest, a timeout or a render error
 * shows the fallback for that remote only; the rest of the page keeps working.
 */
export function RemoteBoundary({ id, loading, timeoutMs, fallback }: RemoteBoundaryProps) {
  const name = id.split('/')[0] ?? id;
  const Fallback = fallback ?? DefaultRemoteFallback;
  const C = remoteComponent(id, { timeoutMs, fallback: Fallback });
  return (
    <RemoteErrorBoundary name={name} fallback={Fallback}>
      <Suspense fallback={loading ?? null}>
        {/* oxlint-disable-next-line react/static-components -- remoteComponent() caches one component per id, so its identity is stable across renders */}
        <C />
      </Suspense>
    </RemoteErrorBoundary>
  );
}

/** Only for tests. */
export function clearRemoteCacheForTests(): void {
  cache.clear();
}
