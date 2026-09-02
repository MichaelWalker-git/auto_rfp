import { render, screen, fireEvent } from '@testing-library/react';
import { ProposalDiffCard } from '../ProposalDiffCard';
import type { ProposedEdit } from '@auto-rfp/core';

const docProposal: ProposedEdit = {
  editId: 'e1',
  target: { kind: 'RFP_DOCUMENT', documentId: 'doc-1', documentTitle: 'Cost Volume', anchor: { kind: 'heading', text: 'Pricing' } },
  before: 'total cost is $2.0M',
  after: 'total cost is $2.4M',
  rationale: 'Align the total across the package',
  advisoryOnly: false,
};

const formProposal: ProposedEdit = {
  editId: 'e2',
  target: { kind: 'FORM', formId: 'form-1', formTitle: 'Pricing Form', fieldId: 'fld-1', fieldLabel: 'Total' },
  before: '$2.0M',
  after: '$2.4M',
  rationale: '',
  advisoryOnly: false,
};

describe('ProposalDiffCard', () => {
  it('renders the target label + rationale for a document proposal', () => {
    render(<ProposalDiffCard proposal={docProposal} selected onToggle={() => {}} />);
    expect(screen.getByText(/Cost Volume · Pricing/)).toBeTruthy();
    expect(screen.getByText('Align the total across the package')).toBeTruthy();
  });

  it('renders both a removed (line-through) and an added diff span', () => {
    const { container } = render(<ProposalDiffCard proposal={docProposal} selected onToggle={() => {}} />);
    // The diff box shows the unchanged text plus a struck-through removed span and
    // a highlighted added span (word-diff tokenizes finely, so assert on classes).
    expect(container.querySelector('.line-through')).toBeTruthy();
    expect(container.querySelector('.bg-green-200')).toBeTruthy();
    expect(container.textContent).toContain('total cost is');
  });

  it('renders a form field target label', () => {
    render(<ProposalDiffCard proposal={formProposal} selected onToggle={() => {}} />);
    expect(screen.getByText(/Pricing Form · Total/)).toBeTruthy();
  });

  it('renders a questionnaire cell target label', () => {
    const questionnaireProposal: ProposedEdit = {
      editId: 'e3',
      target: {
        kind: 'QUESTIONNAIRE',
        documentId: 'q-1',
        documentTitle: 'Security Questionnaire',
        sheetName: 'Sheet1',
        row: 4,
        col: 2,
        ref: 'C5',
      },
      before: 'HORUSTECH',
      after: 'Horus Technology',
      rationale: 'canonical name',
      advisoryOnly: false,
    };
    render(<ProposalDiffCard proposal={questionnaireProposal} selected onToggle={() => {}} />);
    expect(screen.getByText(/Security Questionnaire · cell C5/)).toBeTruthy();
  });

  it('fires onToggle with the editId when the checkbox is clicked', () => {
    const onToggle = jest.fn();
    render(<ProposalDiffCard proposal={docProposal} selected onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith('e1', false);
  });
});
