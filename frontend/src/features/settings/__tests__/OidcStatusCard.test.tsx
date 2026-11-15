import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OidcStatusCard } from '../admin/OidcStatusCard';
import { OidcAdminStatus } from '../../../lib/types';

const base: OidcAdminStatus = {
  configured: true,
  enabled: true,
  name: 'Authentik',
  issuer: 'https://auth.example/application/o/ms/',
  clientId: 'mindsift',
  redirectUrl: 'https://ms.example/api/v1/auth/oidc/callback',
  scopes: 'openid email profile',
  autoCreate: true,
  passwordLogin: true,
  reachable: true,
  linkedUsers: 2,
};

describe('OidcStatusCard', () => {
  it('shows the back-channel logout URL next to the redirect URI, with the hint', () => {
    render(<OidcStatusCard status={{ ...base, logoutUrl: 'https://ms.example/api/v1/auth/oidc/backchannel-logout' }} />);
    expect(screen.getByText('Redirect-URI')).toBeTruthy();
    expect(screen.getByText('Back-Channel-Logout-URL')).toBeTruthy();
    expect(screen.getByText('https://ms.example/api/v1/auth/oidc/backchannel-logout')).toBeTruthy();
    expect(screen.getByText(/ruft sie direkt auf/)).toBeTruthy();
  });

  it('leaves the row out while back-channel logout is off', () => {
    render(<OidcStatusCard status={base} />);
    expect(screen.queryByText('Back-Channel-Logout-URL')).toBeNull();
  });
});
