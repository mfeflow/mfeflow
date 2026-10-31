import { cleanup } from '@testing-library/react';
import { resetPlatform } from '@mfeflow/testing';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../mocks/server';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

afterEach(() => {
  cleanup();
  resetPlatform();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
