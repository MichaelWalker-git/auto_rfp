import { render, screen } from '@testing-library/react';
import type { NotaryRequirement } from '@auto-rfp/core';
import { NotaryTriggerList } from '../NotaryTriggerList';

const req = (overrides: Partial<NotaryRequirement> = {}): NotaryRequirement => ({
  documentName: 'SF-1449.pdf',
  status: 'REQUIRED',
  cue: 'ACK_BLOCK',
  pageNumber: null,
  triggeringText: 'Subscribed and sworn before me',
  ...overrides,
});

describe('NotaryTriggerList', () => {
  it('renders one row per requirement with page, cue, text and rationale', () => {
    render(
      <NotaryTriggerList
        requirements={[
          req({ pageNumber: 3, cue: 'SWORN', triggeringText: 'sworn statement', rationale: 'Contains a jurat block' }),
          req({ pageNumber: null, documentName: 'Attachment B', cue: 'WITNESS', triggeringText: 'witnessed by' }),
        ]}
      />,
    );

    const rows = screen.getAllByTestId('notary-trigger-row');
    expect(rows).toHaveLength(2);

    // Row 1: page locator, cue label, verbatim text, rationale.
    expect(screen.getByText('Page 3')).toBeInTheDocument();
    expect(screen.getByText('Sworn statement')).toBeInTheDocument();
    expect(screen.getByText(/sworn statement/)).toBeInTheDocument();
    expect(screen.getByText('Contains a jurat block')).toBeInTheDocument();

    // Row 2: document-name locator when no page number.
    expect(screen.getByText('Attachment B')).toBeInTheDocument();
    expect(screen.getByText('Witness line')).toBeInTheDocument();
  });

  it('renders an empty-state message when there are no requirements', () => {
    render(<NotaryTriggerList requirements={[]} />);
    expect(screen.queryByTestId('notary-trigger-row')).not.toBeInTheDocument();
    expect(screen.getByText('No trigger detail available.')).toBeInTheDocument();
  });

  it('renders malicious triggeringText as escaped literal text (SEC.1) — no element or handler created', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <NotaryTriggerList requirements={[req({ triggeringText: payload })]} />,
    );

    // The payload appears as visible, literal text...
    expect(screen.getByText(new RegExp('<img src=x onerror=alert\\(1\\)>'))).toBeInTheDocument();
    // ...and NO actual <img> element was ever created from it.
    expect(container.querySelector('img')).toBeNull();
  });
});
