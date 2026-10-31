import { fireEvent, screen } from '@testing-library/react';
import { renderWithPlatform } from '@mfeflow/testing';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('the exposed App', () => {
  it('counts clicks', () => {
    renderWithPlatform(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Clicked 0 times' }));
    expect(screen.getByRole('button', { name: 'Clicked 1 times' })).toBeDefined();
  });
});
