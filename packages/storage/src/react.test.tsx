import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorage } from './index.js';
import { useStoredState } from './react.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Counter({ id }: { id: string }) {
  const storage = createStorage('cart');
  const [count, setCount] = useStoredState(storage, 'count', 0);
  return (
    <button type="button" data-testid={id} onClick={() => setCount((c) => c + 1)}>
      {count}
    </button>
  );
}

describe('useStoredState', () => {
  it('starts from the initial value and persists updates', () => {
    render(<Counter id="a" />);
    const button = screen.getByTestId('a');
    expect(button.textContent).toBe('0');
    act(() => button.click());
    expect(button.textContent).toBe('1');
    expect(localStorage.getItem('cart:count')).toBe('1');
  });

  it('keeps components using the same key in sync', () => {
    render(
      <>
        <Counter id="a" />
        <Counter id="b" />
      </>,
    );
    act(() => screen.getByTestId('a').click());
    expect(screen.getByTestId('b').textContent).toBe('1');
  });

  it('reads an existing stored value', () => {
    localStorage.setItem('cart:count', '41');
    render(<Counter id="a" />);
    expect(screen.getByTestId('a').textContent).toBe('41');
  });
});
