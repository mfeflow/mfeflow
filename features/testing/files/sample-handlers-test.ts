import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from './server';

describe('mock server', () => {
  it('answers the default handlers', async () => {
    const response = await fetch('http://localhost/api/health');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('lets a test replace a handler for that test only', async () => {
    server.use(http.get('*/api/health', () => HttpResponse.json({ ok: false })));
    const response = await fetch('http://localhost/api/health');
    expect(await response.json()).toEqual({ ok: false });
  });
});
