import type { ReactNode } from 'react';
import { AnalyticsProvider } from '@mfeflow/analytics/react';
import { ConsentBanner } from './ConsentBanner';

/** Wraps the shell. Sends a page_view on every route change and shows the consent banner. */
export function Analytics({ children }: { children: ReactNode }) {
  return (
    <AnalyticsProvider>
      {children}
      <ConsentBanner />
    </AnalyticsProvider>
  );
}
