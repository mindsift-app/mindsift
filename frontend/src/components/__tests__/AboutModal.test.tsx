import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AboutModal, THIRD_PARTY_LICENSES_URL } from '../AboutModal';

describe('AboutModal', () => {
  it('links the licenses of the third-party software served by the server, in a new tab', () => {
    render(<AboutModal onClose={() => {}} />);
    expect(screen.getByText('Fremdsoftware')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Lizenzen der enthaltenen Bibliotheken/ });
    expect(link.getAttribute('href')).toBe('/third-party-licenses.txt');
    expect(THIRD_PARTY_LICENSES_URL).toBe('/third-party-licenses.txt');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
