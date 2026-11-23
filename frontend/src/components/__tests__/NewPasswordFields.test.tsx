import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewPasswordFields } from '../NewPasswordFields';

function Form() {
  const [value, setValue] = useState('');
  const [repeat, setRepeat] = useState('');
  return (
    <NewPasswordFields
      value={value}
      onChange={setValue}
      repeat={repeat}
      onRepeatChange={setRepeat}
      label="Neues Passwort"
      repeatLabel="Neues Passwort wiederholen"
      inputClassName="h-11"
    />
  );
}

describe('NewPasswordFields', () => {
  it('shows the hint while the repetition differs', () => {
    render(<Form />);
    const next = screen.getByLabelText('Neues Passwort');
    const repeat = screen.getByLabelText('Neues Passwort wiederholen');
    fireEvent.change(next, { target: { value: 'geheim123' } });
    expect(screen.queryByText(/stimmen nicht überein/)).toBeNull();

    fireEvent.change(repeat, { target: { value: 'geheim12' } });
    expect(screen.getByText(/stimmen nicht überein/)).toBeTruthy();
    expect(repeat.getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(repeat, { target: { value: 'geheim123' } });
    expect(screen.queryByText(/stimmen nicht überein/)).toBeNull();
    expect(repeat.getAttribute('aria-invalid')).toBeNull();
  });
});
