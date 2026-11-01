import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from './keys';

/** An example query: the API's health check through the http client, cancelled when the component unmounts. */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => api.get('health', { signal }),
  });
}
