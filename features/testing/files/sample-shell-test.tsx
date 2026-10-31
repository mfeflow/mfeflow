import { screen } from '@testing-library/react';
import { renderWithPlatform } from '@mfeflow/testing';
import { describe, expect, it } from 'vitest';
import { Home } from './Home';

describe('Home', () => {
  it('says so when the registry listed no remotes', () => {
    renderWithPlatform(<Home />);
    expect(screen.getByText(/No remotes yet/)).toBeDefined();
  });
});
