import { render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { Query, queryClient } from './Query';

function Value() {
  const { data } = useQuery({ queryKey: ['shell', 'answer'], queryFn: () => Promise.resolve(42) });
  return <p>{data ?? 'loading'}</p>;
}

describe('Query', () => {
  it('gives the app one cache', async () => {
    render(
      <Query>
        <Value />
      </Query>,
    );
    expect(await screen.findByText('42')).toBeDefined();
    expect(queryClient.getQueryData(['shell', 'answer'])).toBe(42);
  });
});
