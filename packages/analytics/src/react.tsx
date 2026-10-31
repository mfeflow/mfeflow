import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { DENY_ALL, GRANT_ALL } from './consent';
import { getConsent, pageOnce, subscribeConsent, updateConsent } from './core';
import { onNavigate } from './history';
import {
  createTracker,
  type EventName,
  type ParamsArg,
  type Tracker,
  type TrackerOptions,
} from './tracker';
import type { ConsentUpdate } from './types';
import { warnOnce } from './validate';

const Mounted = createContext(false);

function sendPageView(path: string): void {
  pageOnce(path, { mfe: { name: 'shell' } });
}

export interface AnalyticsProviderProps {
  children: ReactNode;
  /** Send a `page_view` for the first page and for every navigation. Default true. */
  pageViews?: boolean;
}

/**
 * The shell wraps its app in this once. It sends `page_view` on route changes, once per path
 * even when React runs effects twice, and lets `useTracker` tell a missing shell from a ready one.
 */
export function AnalyticsProvider({ children, pageViews = true }: AnalyticsProviderProps) {
  useEffect(() => {
    if (!pageViews) return undefined;
    sendPageView(location.pathname);
    return onNavigate(sendPageView);
  }, [pageViews]);
  return <Mounted value={true}>{children}</Mounted>;
}

/** The tracker for a remote. The same tracker comes back on every render. */
export function useTracker(mfeName: string, options?: TrackerOptions): Tracker {
  const mounted = useContext(Mounted);
  useEffect(() => {
    if (!mounted) {
      warnOnce(
        `${mfeName}: no <AnalyticsProvider> above this component. Running outside the shell? Events wait for analytics to start and are dropped if it never does.`,
      );
    }
  }, [mounted, mfeName]);
  // The options only matter the first time: a new array on every render must not rebuild the tracker.
  // oxlint-disable-next-line react/exhaustive-deps -- see above
  return useMemo(() => createTracker(mfeName, options), [mfeName]);
}

/** Sends an event once when the component mounts. Safe under StrictMode, which runs effects twice. */
export function useTrackOnMount<E extends EventName>(
  tracker: Tracker,
  event: E,
  ...params: ParamsArg<E>
): void {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    tracker.track(event, ...params);
    // The event is sent once, with the values from the first render.
    // oxlint-disable-next-line react/exhaustive-deps -- intentionally not re-sent on change
  }, []);
}

export interface ConsentApi {
  consent: ConsentUpdate;
  /** Whether the visitor has chosen yet. Show the banner while this is false. */
  decided: boolean;
  update: (update: ConsentUpdate) => void;
  acceptAll: () => void;
  rejectAll: () => void;
}

/** Headless consent state for your own banner. */
export function useConsent(): ConsentApi {
  const consent = useSyncExternalStore(subscribeConsent, getConsent, getConsent);
  return {
    consent,
    decided: Object.keys(consent).length > 0,
    update: updateConsent,
    acceptAll: () => {
      updateConsent(GRANT_ALL);
    },
    rejectAll: () => {
      updateConsent(DENY_ALL);
    },
  };
}
