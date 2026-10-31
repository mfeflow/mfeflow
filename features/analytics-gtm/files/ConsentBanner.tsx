import { useConsent } from '@mfeflow/analytics/react';

// Yours to restyle or replace. Until the visitor chooses, every consent signal stays denied.
export function ConsentBanner() {
  const { decided, acceptAll, rejectAll } = useConsent();
  if (decided) return null;
  return (
    <section aria-label="Cookie consent" data-testid="consent-banner">
      <p>We use cookies to measure how the site is used.</p>
      <button type="button" onClick={acceptAll}>
        Accept
      </button>
      <button type="button" onClick={rejectAll}>
        Reject
      </button>
    </section>
  );
}
