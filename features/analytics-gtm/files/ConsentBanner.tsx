import { useConsent } from '@mfeflow/analytics/react';

// Yours to restyle or replace. Until the visitor chooses, every consent signal stays denied, and
// each button grants only what its label says.
export function ConsentBanner() {
  const { decided, update, rejectAll } = useConsent();
  if (decided) return null;
  return (
    <section aria-label="Cookie consent" data-testid="consent-banner">
      <p>
        We use analytics cookies to measure how the site is used. Advertising cookies are optional
        and stay off unless you allow them.
      </p>
      <button
        type="button"
        data-testid="consent-accept-analytics"
        onClick={() => {
          update({
            analytics_storage: 'granted',
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
          });
        }}
      >
        Accept analytics
      </button>
      <button
        type="button"
        data-testid="consent-accept-ads"
        onClick={() => {
          update({
            analytics_storage: 'granted',
            ad_storage: 'granted',
            ad_user_data: 'granted',
            ad_personalization: 'granted',
          });
        }}
      >
        Accept analytics and advertising
      </button>
      <button type="button" data-testid="consent-reject" onClick={rejectAll}>
        Reject
      </button>
    </section>
  );
}
