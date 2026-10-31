import { getConsent, resetAnalyticsForTests } from '@mfeflow/analytics';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConsentBanner } from './ConsentBanner';

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetAnalyticsForTests();
});

describe('ConsentBanner', () => {
  it('grants analytics only, and denies advertising, on "Accept analytics"', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByText('Accept analytics'));
    expect(getConsent()).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    expect(screen.queryByTestId('consent-banner')).toBeNull();
  });

  it('grants advertising too only on its own button', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByText('Accept analytics and advertising'));
    expect(getConsent()).toMatchObject({ analytics_storage: 'granted', ad_storage: 'granted' });
  });

  it('denies everything on Reject', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByText('Reject'));
    expect(Object.values(getConsent())).toEqual(['denied', 'denied', 'denied', 'denied']);
  });
});
