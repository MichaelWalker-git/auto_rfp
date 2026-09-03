import React from 'react';
import { render, screen } from '@testing-library/react';

import { AiNotConfiguredNotice } from '../ai-not-configured-notice';
import { isAiNotConfiguredError } from '@/lib/ai-not-configured';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('AiNotConfiguredNotice', () => {
  it('renders the shared title and a link to the org integration settings', () => {
    render(<AiNotConfiguredNotice orgId="org-42" />);

    expect(screen.getByText('AI is not configured')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /integration settings/i });
    expect(link).toHaveAttribute('href', '/organizations/org-42/settings');
  });

  it('renders a custom description when provided', () => {
    render(<AiNotConfiguredNotice orgId="org-42" description="Custom copy here." />);
    expect(screen.getByText('Custom copy here.')).toBeInTheDocument();
  });

  // Mirrors the wiring contract: a surface shows the notice only when the guard
  // recognises the AI-not-configured error, and hides it otherwise.
  it('is shown when the AI-not-configured error is surfaced and hidden otherwise', () => {
    const Surface = ({ error }: { error: unknown }) =>
      isAiNotConfiguredError(error) ? <AiNotConfiguredNotice orgId="org-1" /> : <div>All good</div>;

    const { rerender } = render(
      <Surface error={{ status: 409, details: { code: 'AI_NOT_CONFIGURED' } }} />,
    );
    expect(screen.getByText('AI is not configured')).toBeInTheDocument();

    rerender(<Surface error={new Error('Bedrock timeout')} />);
    expect(screen.queryByText('AI is not configured')).not.toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();
  });
});
