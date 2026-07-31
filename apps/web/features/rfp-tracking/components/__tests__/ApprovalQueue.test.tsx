import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalQueue } from '../ApprovalQueue';
import { makeItem, approvalTransition } from '../../__tests__/fixtures';

const mockDecide = jest.fn();
let hookState = { decide: mockDecide, pendingOppId: null as string | null, error: null as string | null };

jest.mock('../../hooks/use-approval-decision', () => ({
  useApprovalDecision: () => hookState,
}));

const NOW = '2026-07-27T00:00:00.000Z';

beforeEach(() => {
  jest.clearAllMocks();
  hookState = { decide: mockDecide, pendingOppId: null, error: null };
});

const initialItem = (id: string, enteredIso: string) =>
  makeItem({
    id,
    oppId: id,
    title: `RFP ${id}`,
    approvalStatus: 'INITIAL_APPROVAL',
    approvalHistory: [approvalTransition('INITIAL_APPROVAL', enteredIso)],
  });

const preSubItem = (id: string) =>
  makeItem({ id, oppId: id, title: `RFP ${id}`, approvalStatus: 'PRE_SUB_APPROVAL' });

describe('ApprovalQueue', () => {
  it('shows the empty state when nothing is awaiting approval', () => {
    render(<ApprovalQueue items={[makeItem({ approvalStatus: 'I_APPROVED' })]} orgId="org-1" nowIso={NOW} />);
    expect(screen.getByText(/nothing is waiting for approval/i)).toBeTruthy();
  });

  it('lists initial-approval items oldest-first', () => {
    const items = [
      initialItem('newer', '2026-07-20T00:00:00.000Z'),
      initialItem('older', '2026-07-01T00:00:00.000Z'),
    ];
    render(<ApprovalQueue items={items} orgId="org-1" nowIso={NOW} />);
    const rows = screen.getAllByText(/^RFP /);
    expect(rows[0]!.textContent).toBe('RFP older');
    expect(rows[1]!.textContent).toBe('RFP newer');
  });

  it('renders a Deadline column with the item deadline', () => {
    const item = makeItem({
      id: 'a',
      oppId: 'a',
      title: 'RFP a',
      approvalStatus: 'INITIAL_APPROVAL',
      responseDeadlineIso: '2026-07-28T00:00:00.000Z', // 1 day out
    });
    render(<ApprovalQueue items={[item]} orgId="org-1" nowIso={NOW} />);
    expect(screen.getByText('Deadline')).toBeTruthy();
    expect(screen.getByText(/1d left/i)).toBeTruthy();
  });

  it('renders Approve/Reject for gate 1 and calls decide with the INITIAL gate', () => {
    render(<ApprovalQueue items={[initialItem('a', '2026-07-01T00:00:00.000Z')]} orgId="org-1" nowIso={NOW} />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(mockDecide).toHaveBeenCalledWith({ projectId: 'proj-1', oppId: 'a', gate: 'INITIAL', decision: 'APPROVE' });

    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(mockDecide).toHaveBeenCalledWith({ projectId: 'proj-1', oppId: 'a', gate: 'INITIAL', decision: 'REJECT' });
  });

  it('renders only Approve (no Reject) for gate 2 and calls decide with the FINAL gate', () => {
    render(<ApprovalQueue items={[preSubItem('b')]} orgId="org-1" nowIso={NOW} />);
    expect(screen.queryByRole('button', { name: /^reject$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(mockDecide).toHaveBeenCalledWith({ projectId: 'proj-1', oppId: 'b', gate: 'FINAL', decision: 'APPROVE' });
  });

  it('shows gate-1 Approve/Reject for every member (approval is open)', () => {
    render(
      <ApprovalQueue
        items={[initialItem('a', '2026-07-01T00:00:00.000Z')]}
        orgId="org-1"
        nowIso={NOW}
      />,
    );
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeTruthy();
    expect(screen.getByText('RFP a')).toBeTruthy();
  });

  it('shows the gate-2 Approve for every member (approval is open)', () => {
    render(
      <ApprovalQueue
        items={[preSubItem('b')]}
        orgId="org-1"
        nowIso={NOW}
      />,
    );
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeTruthy();
    expect(screen.getByText('RFP b')).toBeTruthy();
  });

  it('disables the buttons for the row currently being decided', () => {
    hookState = { decide: mockDecide, pendingOppId: 'a', error: null };
    render(<ApprovalQueue items={[initialItem('a', '2026-07-01T00:00:00.000Z')]} orgId="org-1" nowIso={NOW} />);
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeDisabled();
  });

  it('surfaces a hook error message', () => {
    hookState = { decide: mockDecide, pendingOppId: null, error: 'Forbidden' };
    render(<ApprovalQueue items={[initialItem('a', '2026-07-01T00:00:00.000Z')]} orgId="org-1" nowIso={NOW} />);
    expect(screen.getByText('Forbidden')).toBeTruthy();
  });
});
