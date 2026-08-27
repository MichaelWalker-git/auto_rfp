import { render, screen } from '@testing-library/react';
import type { NotarySummary } from '@auto-rfp/core';
import { OpportunityNotaryChip } from '../OpportunityNotaryChip';

const summary = (overrides: Partial<NotarySummary> = {}): NotarySummary => ({
  anyNotaryRequired: true,
  requiredCount: 0,
  possiblyRequiredCount: 0,
  totalFormsConsidered: 0,
  ...overrides,
});

describe('OpportunityNotaryChip', () => {
  it('renders the chip with count label and aria-label when notary is required', () => {
    render(
      <OpportunityNotaryChip summary={summary({ requiredCount: 2, possiblyRequiredCount: 1 })} />,
    );
    const chip = screen.getByTestId('opportunity-notary-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('⚖ Notary: 3 forms');
    expect(chip).toHaveAttribute('aria-label', '3 forms need notarization');
  });

  it('renders nothing when the summary is null', () => {
    const { container } = render(<OpportunityNotaryChip summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the summary is undefined', () => {
    const { container } = render(<OpportunityNotaryChip summary={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when anyNotaryRequired is false', () => {
    const { container } = render(
      <OpportunityNotaryChip summary={summary({ anyNotaryRequired: false, requiredCount: 5 })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('uses singular wording for one flagged form', () => {
    render(
      <OpportunityNotaryChip summary={summary({ requiredCount: 1, possiblyRequiredCount: 0 })} />,
    );
    const chip = screen.getByTestId('opportunity-notary-chip');
    expect(chip).toHaveTextContent('⚖ Notary: 1 form');
    expect(chip).toHaveAttribute('aria-label', '1 form needs notarization');
  });

  it('drops the count when flagged only at solicitation level (zero flagged forms)', () => {
    render(<OpportunityNotaryChip summary={summary()} />);
    const chip = screen.getByTestId('opportunity-notary-chip');
    expect(chip).toHaveTextContent('⚖ Notary required');
    expect(chip).toHaveAttribute('aria-label', 'Notarization required for this opportunity');
  });
});
