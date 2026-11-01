import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContactForm } from './ContactForm';
import type { ContactValues } from './schema';

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('ContactForm', () => {
  it('shows what is wrong and does not submit', async () => {
    const onSubmit = vi.fn();
    render(<ContactForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findAllByRole('alert')).length).toBe(3);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the values once, even when the button is clicked twice', async () => {
    const onSubmit = vi.fn(
      (_values: ContactValues) => new Promise<void>((resolve) => setTimeout(resolve, 50)),
    );
    render(<ContactForm onSubmit={onSubmit} />);
    fill('Name', 'Asha');
    fill('Email', 'asha@example.com');
    fill('Message', 'Hello, this is long enough.');
    const button = screen.getByRole('button', { name: 'Send' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ name: 'Asha', email: 'asha@example.com' });
  });
});
