import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SetupSummary } from '../SetupSummary';
import { SetupChoices } from '../SetupInstanceSection';

const info = { smtpConfigured: false, smtpViaEnv: false, baseUrlSet: false, emailLinks: false, backupDir: '/data/backups' };
const choices = (timeZone: string): SetupChoices => ({
  instanceName: 'MindSift',
  sharingMode: 'organizations',
  allowRegistration: false,
  createSampleData: false,
  defaultLanguage: 'de',
  timeZone,
  backupEnabled: true,
  backupTime: '03:00',
  backupRetentionDays: 14,
});

describe('SetupSummary: backup time', () => {
  it('names the time zone chosen in the wizard', () => {
    render(<SetupSummary heading="Zusammenfassung" info={info} choices={choices('America/Los_Angeles')} wizardSmtpHost="" />);
    expect(screen.getByTestId('setup-summary').textContent).toContain('Tägliche Backups um 03:00 (America/Los Angeles)');
  });

  it('says the server decides when no zone is chosen', () => {
    render(<SetupSummary heading="Zusammenfassung" info={info} choices={choices('')} wizardSmtpHost="" />);
    expect(screen.getByTestId('setup-summary').textContent).toContain('Tägliche Backups um 03:00 (Zeitzone des Servers: TZ, sonst UTC)');
  });
});
