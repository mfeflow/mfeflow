import { createHttpClient } from '@mfeflow/http';
import { apiUrl, type endpoints } from './endpoints';

// What each endpoint answers with, by the name in ./endpoints. Add a line per endpoint you call.
interface Responses {
  health: { ok: boolean };
}

/**
 * One client per app over the endpoints in ./endpoints. The base URL is the runtime config's
 * `apiUrl`. Idempotent requests retry on a network error, a timeout and a 502, 503 or 504; a
 * failure is an HttpError with the status and body, and no URL in its message.
 *
 *   const { ok } = await api.get('health');
 */
export const api = createHttpClient<typeof endpoints, Responses>({
  url: apiUrl,
  // Return the signed-in user's token; no header is sent while this returns undefined.
  // getToken: () => session.accessToken(),
});
