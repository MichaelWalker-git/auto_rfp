import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineCard } from '../PipelineCard';
import { toBoardCard } from '../../lib/derive-board';
import { makeItem, approvalTransition } from '../../__tests__/fixtures';

const mockAdvance = jest.fn();
jest.mock('../../hooks/use-approval-advance', () => ({
  useApprovalAdvance: () => ({ advance: mockAdvance, pendingOppId: null, error: null }),
}));

const mockSetStage = jest.fn();
jest.mock('../../hooks/use-ace-stage', () => ({
  useAceStage: () => ({ setStage: mockSetStage, pendingOppId: null, error: null }),
}));

const NOW = '2026-07-27T00:00:00.000Z';

beforeEach(() => jest.clearAllMocks());

describe('PipelineCard', () => {
  it('renders title, owner, value, stage badge, and days-in-stage', () => {
    const item = makeItem({
      title: 'Cloud RFP',
      assigneeName: 'Jane Doe',
      baseAndAllOptionsValue: 250_000,
      approvalStatus: 'PRE_SUB_APPROVAL',
      pipelineStage: 'preSubmissionReview',
      approvalHistory: [approvalTransition('PRE_SUB_APPROVAL', '2026-07-17T00:00:00.000Z', 'I_APPROVED', 'STAGE')],
    });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);

    expect(screen.getByText('Cloud RFP')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('$250,000')).toBeTruthy();
    expect(screen.getByText('Pre-submission review')).toBeTruthy();
    expect(screen.getByText(/10d in stage/)).toBeTruthy();
  });

  it('opens the detail panel when the card body is clicked', () => {
    const item = makeItem({ id: 'opp-9', oppId: 'opp-9', projectId: 'proj-7', title: 'Cloud RFP' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-3" canAdvance={false} />);

    // Closed initially — no detail panel dialog rendered.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /cloud rfp/i }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /view full opportunity/i }).getAttribute('href'),
    ).toBe('/organizations/org-3/projects/proj-7/opportunities/opp-9');
  });

  it('drops the deadline badge on a submitted card (deadline is moot once the response is in)', () => {
    const item = makeItem({
      pipelineStage: 'submitted',
      responseDeadlineIso: '2026-07-01T00:00:00.000Z', // 26d before NOW → would be "Overdue 26d"
    });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it('still shows the overdue badge on a non-submitted card past its deadline', () => {
    const item = makeItem({
      pipelineStage: 'inProgress',
      responseDeadlineIso: '2026-07-01T00:00:00.000Z',
    });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);
    expect(screen.getByText(/overdue/i)).toBeTruthy();
  });

  it('shows "Unassigned" when there is no owner', () => {
    const item = makeItem({ assigneeName: undefined });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('shows no advance action on I_APPROVED (First approved / In progress carry no button)', () => {
    const item = makeItem({ id: 'opp-1', oppId: 'opp-1', projectId: 'proj-1', approvalStatus: 'I_APPROVED' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance />);
    expect(screen.queryByRole('button', { name: /send for pre-sub review/i })).toBeNull();
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it('offers "Mark Submitted" on II_APPROVED and advances to SUBMITTED without opening the panel', () => {
    const item = makeItem({ id: 'opp-2', oppId: 'opp-2', projectId: 'proj-1', approvalStatus: 'II_APPROVED' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance />);
    fireEvent.click(screen.getByRole('button', { name: /mark submitted/i }));
    expect(mockAdvance).toHaveBeenCalledWith({ projectId: 'proj-1', oppId: 'opp-2', to: 'SUBMITTED' });
    // The advance button is a sibling of the click target, so acting on it must not open the detail panel.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides the "Mark Submitted" action when canAdvance is false', () => {
    const item = makeItem({ approvalStatus: 'II_APPROVED', projectId: 'proj-1' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);
    expect(screen.queryByRole('button', { name: /mark submitted/i })).toBeNull();
  });

  it('shows no advance action on a non-advanceable stage', () => {
    const item = makeItem({ approvalStatus: 'INITIAL_APPROVAL', projectId: 'proj-1' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance />);
    expect(screen.queryByRole('button', { name: /send for pre-sub review|mark submitted/i })).toBeNull();
  });

  it('renders the ACE stage dropdown when canAdvance is true', () => {
    const item = makeItem({ projectId: 'proj-1', aceStage: 'Prospect' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance />);
    expect(screen.getByRole('combobox', { name: /ace stage/i })).toBeTruthy();
  });

  it('hides the ACE stage dropdown when canAdvance is false', () => {
    const item = makeItem({ projectId: 'proj-1', aceStage: 'Prospect' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);
    expect(screen.queryByRole('combobox', { name: /ace stage/i })).toBeNull();
  });
});
