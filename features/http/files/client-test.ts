import { isHttpError } from '@mfeflow/http';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { api } from './client';

describe('the api client', () => {
  it('reads an endpoint through the mock server', async () => {
    expect(await api.get('health')).toEqual({ ok: true });
  });

  it('turns a failure into an HttpError with the status', async () => {
    server.use(
      http.get('*/api/health', () => HttpResponse.json({ error: 'down' }, { status: 404 })),
    );
    const error = await api.get('health').catch((e: unknown) => e);
    expect(isHttpError(error) && error.status).toBe(404);
  });
});
