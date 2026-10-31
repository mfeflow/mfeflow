import { http, HttpResponse } from 'msw';

// Requests a test makes are answered here. Add the endpoints your app calls;
// a request nothing answers fails the test (see src/test/setup.ts).
export const handlers = [http.get('*/api/health', () => HttpResponse.json({ ok: true }))];
