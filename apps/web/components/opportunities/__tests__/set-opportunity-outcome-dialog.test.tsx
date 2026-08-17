import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetOpportunityOutcomeDialog } from '../set-opportunity-outcome-dialog';
import type { LossData, OpportunityItem, OpportunityUpdateRequest } from '@auto-rfp/core';

const mockUpdateOpportunity = jest.fn();
const mockToast = jest.fn();

jest.mock('@/lib/hooks/use-opportunities', () => ({
  useUpdateOpportunity: () => ({
    trigger: mockUpdateOpportunity,
    isMutating: false,
  }),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Dialog renders through a portal, which testing-library can reach but which also
// pulls in focus traps that fight with userEvent. A plain wrapper is enough here.
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

// The status Select is not exercised by these tests — the LOST branch is reached via
// `opportunity.status`, which is how a user re-opening a recorded loss reaches it too.
// Radix's Select needs pointer-capture APIs jsdom lacks, so it is stubbed to a native
// select to keep the rest of the form mountable.
jest.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <div data-testid="select" data-value={value}>
      <button type="button" onClick={() => onValueChange(value)}>
        {children}
      </button>
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SelectValue: () => null,
}));

const baseOpportunity: OpportunityItem = {
  id: 'opp-1',
  oppId: 'opp-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  source: 'SAM_GOV',
  title: 'Student Prospect Digital Profile Solution',
  type: null,
  postedDateIso: null,
  responseDeadlineIso: null,
  noticeId: null,
  solicitationNumber: 'RFP 739',
  naicsCode: null,
  pscCode: null,
  organizationName: 'TTUHSC',
  setAside: null,
  description: null,
  baseAndAllOptionsValue: null,
  status: 'LOST',
};

const defaultProps = {
  isOpen: true,
  onOpenChange: jest.fn(),
  orgId: 'org-1',
  projectId: 'proj-1',
  oppId: 'opp-1',
  opportunity: baseOpportunity,
};

/** The `lossData` the component actually sent, so tests can assert on absent keys. */
const submittedLossData = (): LossData | undefined => {
  const [arg] = mockUpdateOpportunity.mock.calls[0] as [
    { patch: OpportunityUpdateRequest },
  ];
  return arg.patch.lossData;
};

const renderDialog = (opportunity: OpportunityItem = baseOpportunity) =>
  render(<SetOpportunityOutcomeDialog {...defaultProps} opportunity={opportunity} />);

const submit = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /save outcome/i }));
};

describe('SetOpportunityOutcomeDialog — loss pricing and evaluation scores', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateOpportunity.mockResolvedValue({});
  });

  describe('bid amounts', () => {
    it('submits both bid amounts as numbers', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(screen.getByLabelText(/our bid amount/i), '250000');
      await user.type(screen.getByLabelText(/winning bid amount/i), '198500');
      await submit(user);

      await waitFor(() => expect(mockUpdateOpportunity).toHaveBeenCalled());
      expect(submittedLossData()).toEqual(
        expect.objectContaining({ ourBidAmount: 250000, winningBidAmount: 198500 }),
      );
    });

    it('OMITS both amounts entirely when left blank — never coerces to 0', async () => {
      const user = userEvent.setup();
      renderDialog();

      await submit(user);

      await waitFor(() => expect(mockUpdateOpportunity).toHaveBeenCalled());
      const lossData = submittedLossData();
      // A recorded bid of $0 is a factual claim about a procurement; "unknown" is not.
      expect(lossData).not.toHaveProperty('ourBidAmount');
      expect(lossData).not.toHaveProperty('winningBidAmount');
    });

    it('submits only the amount that was entered', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(screen.getByLabelText(/our bid amount/i), '250000');
      await submit(user);

      await waitFor(() => expect(mockUpdateOpportunity).toHaveBeenCalled());
      const lossData = submittedLossData();
      expect(lossData?.ourBidAmount).toBe(250000);
      expect(lossData).not.toHaveProperty('winningBidAmount');
    });

    it('treats a genuinely entered 0 as a recorded amount', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(screen.getByLabelText(/our bid amount/i), '0');
      await submit(user);

      await waitFor(() => expect(mockUpdateOpportunity).toHaveBeenCalled());
      expect(submittedLossData()?.ourBidAmount).toBe(0);
    });

    it('does not submit a negative bid amount', async () => {
      const user = userEvent.setup();
      renderDialog();

      const input = screen.getByLabelText(/our bid amount/i);
      fireEvent.change(input, { target: { value: '-100' } });
      await submit(user);

      // `min={0}` makes this a constraint-validation failure, so the browser blocks
      // the submit before the handler runs — nothing reaches the API either way.
      expect(input).toBeInvalid();
      expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    });

    it('rejects a negative bid amount that bypassed constraint validation', () => {
      renderDialog();

      fireEvent.change(screen.getByLabelText(/our bid amount/i), { target: { value: '-100' } });
      // Dispatched directly, as a programmatic form.submit() would — no validation gate.
      fireEvent.submit(screen.getByRole('button', { name: /save outcome/i }).closest('form')!);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Bid amounts cannot be negative' }),
      );
      expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    });
  });

  describe('evaluation scores', () => {
    it('keeps the score inputs behind a disclosure until asked for', async () => {
      const user = userEvent.setup();
      renderDialog();

      expect(screen.queryByLabelText(/^technical$/i)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /add evaluation scores/i }));

      expect(screen.getByLabelText(/^technical$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^price$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^past performance$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^management$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^overall$/i)).toBeInTheDocument();
    });

    it('names the source of the numbers, so they are not confused with our own estimate', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: /add evaluation scores/i }));

      expect(
        screen.getByText(/from a debrief or a released scoring sheet/i),
      ).toBeInTheDocument();
    });

    it('submits entered scores under evaluationScores', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: /add evaluation scores/i }));
      await user.type(screen.getByLabelText(/^technical$/i), '72');
      await user.type(screen.getByLabelText(/^price$/i), '88');
      await user.type(screen.getByLabelText(/^overall$/i), '78');
      await submit(user);

      await waitFor(() => expect(mockUpdateOpportunity).toHaveBeenCalled());
      // Only the three criteria touched — the untouched two are absent, not 0.
      expect(submittedLossData()?.evaluationScores).toEqual({
        technical: 72,
        price: 88,
        overall: 78,
      });
    });

    it('OMITS evaluationScores entirely when no criterion was scored', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: /add evaluation scores/i }));
      await submit(user);

      await waitFor(() => expect(mockUpdateOpportunity).toHaveBeenCalled());
      // An empty object would make the dashboard count this loss as scored.
      expect(submittedLossData()).not.toHaveProperty('evaluationScores');
    });

    it('marks a score above 100 invalid while the disclosure is open', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: /add evaluation scores/i }));
      const input = screen.getByLabelText(/^technical$/i);
      fireEvent.change(input, { target: { value: '105' } });
      await submit(user);

      // While mounted, `max={100}` blocks the submit via constraint validation.
      expect(input).toBeInvalid();
      expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    });

    /**
     * The regression that motivates the JS range check. Collapsing the disclosure
     * unmounts the inputs, so the browser stops validating them — but their values
     * are held in component state and would otherwise be submitted. A score of 105
     * renders as a bar wider than its container on the dashboard.
     */
    it('rejects a score above 100 entered then hidden by collapsing the disclosure', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: /add evaluation scores/i }));
      fireEvent.change(screen.getByLabelText(/^technical$/i), { target: { value: '105' } });
      await user.click(screen.getByRole('button', { name: /hide evaluation scores/i }));
      expect(screen.queryByLabelText(/^technical$/i)).not.toBeInTheDocument();

      await submit(user);

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Scores must be between 0 and 100',
            description: expect.stringContaining('Technical'),
          }),
        ),
      );
      expect(mockUpdateOpportunity).not.toHaveBeenCalled();
      // The rejection re-opens the section, so the named field is visible again.
      expect(screen.getByLabelText(/^technical$/i)).toBeInTheDocument();
    });

    it('rejects a score below 0 entered then hidden by collapsing the disclosure', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: /add evaluation scores/i }));
      fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '-1' } });
      await user.click(screen.getByRole('button', { name: /hide evaluation scores/i }));

      await submit(user);

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Scores must be between 0 and 100',
            description: expect.stringContaining('Price'),
          }),
        ),
      );
      expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    });

    it('accepts the 0 and 100 boundaries', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: /add evaluation scores/i }));
      await user.type(screen.getByLabelText(/^technical$/i), '0');
      await user.type(screen.getByLabelText(/^overall$/i), '100');
      await submit(user);

      await waitFor(() => expect(mockUpdateOpportunity).toHaveBeenCalled());
      expect(submittedLossData()?.evaluationScores).toEqual({ technical: 0, overall: 100 });
    });
  });

  describe('prefill from stored lossData', () => {
    const storedOpportunity: OpportunityItem = {
      ...baseOpportunity,
      lossData: {
        lossDate: '2026-01-29T00:00:00.000Z',
        lossReason: 'PRICE_TOO_HIGH',
        winningContractor: 'Acme Systems',
        ourBidAmount: 250000,
        winningBidAmount: 198500,
        evaluationScores: { technical: 72, price: 88, overall: 78 },
      },
    };

    it('populates the bid amount inputs', () => {
      renderDialog(storedOpportunity);

      expect(screen.getByLabelText(/our bid amount/i)).toHaveValue(250000);
      expect(screen.getByLabelText(/winning bid amount/i)).toHaveValue(198500);
    });

    it('opens the disclosure and populates stored scores, leaving unscored criteria blank', () => {
      renderDialog(storedOpportunity);

      expect(screen.getByLabelText(/^technical$/i)).toHaveValue(72);
      expect(screen.getByLabelText(/^price$/i)).toHaveValue(88);
      expect(screen.getByLabelText(/^overall$/i)).toHaveValue(78);
      expect(screen.getByLabelText(/^management$/i)).toHaveValue(null);
      expect(screen.getByLabelText(/^past performance$/i)).toHaveValue(null);
    });

    /**
     * A stored score of exactly 0 must still open the disclosure.
     *
     * The guard is `typeof v === 'number'` rather than a truthiness check precisely
     * because 0 is a real score. With `Boolean(v)` the section stays collapsed, the
     * person editing reasonably concludes nothing was scored, and re-submitting from
     * that state drops the 0 from evaluationScores entirely.
     */
    it('opens the disclosure for a stored score of exactly 0', () => {
      renderDialog({
        ...baseOpportunity,
        lossData: {
          lossDate: '2026-01-29T00:00:00.000Z',
          lossReason: 'PRICE_TOO_HIGH',
          evaluationScores: { technical: 0 },
        },
      });

      // Visible without clicking the disclosure open.
      expect(screen.getByLabelText(/^technical$/i)).toHaveValue(0);
    });

    it('leaves the disclosure closed when no criterion is scored', () => {
      renderDialog({
        ...baseOpportunity,
        lossData: { lossDate: '2026-01-29T00:00:00.000Z', lossReason: 'UNKNOWN' },
      });

      expect(screen.queryByLabelText(/^technical$/i)).not.toBeInTheDocument();
    });

    it('leaves the amount inputs blank — not 0 — when nothing is stored', () => {
      renderDialog({
        ...baseOpportunity,
        lossData: { lossDate: '2026-01-29T00:00:00.000Z', lossReason: 'UNKNOWN' },
      });

      expect(screen.getByLabelText(/our bid amount/i)).toHaveValue(null);
      expect(screen.getByLabelText(/winning bid amount/i)).toHaveValue(null);
    });

    it('re-submits prefilled amounts unchanged', async () => {
      const user = userEvent.setup();
      renderDialog(storedOpportunity);

      await submit(user);

      await waitFor(() => expect(mockUpdateOpportunity).toHaveBeenCalled());
      expect(submittedLossData()).toEqual(
        expect.objectContaining({
          ourBidAmount: 250000,
          winningBidAmount: 198500,
          evaluationScores: { technical: 72, price: 88, overall: 78 },
        }),
      );
    });
  });

  describe('the new fields never block a submission', () => {
    it('submits a loss with none of the new fields filled', async () => {
      const user = userEvent.setup();
      const onOpenChange = jest.fn();
      const onSuccess = jest.fn();
      render(
        <SetOpportunityOutcomeDialog
          {...defaultProps}
          onOpenChange={onOpenChange}
          onSuccess={onSuccess}
        />,
      );

      await submit(user);

      await waitFor(() =>
        expect(mockUpdateOpportunity).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: 'proj-1',
            oppId: 'opp-1',
            patch: expect.objectContaining({ status: 'LOST' }),
          }),
        ),
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Outcome updated' }),
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onSuccess).toHaveBeenCalled();
    });

    it('does not render the loss fields for a non-loss outcome', () => {
      renderDialog({ ...baseOpportunity, status: 'WON' });

      expect(screen.queryByLabelText(/our bid amount/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /add evaluation scores/i }),
      ).not.toBeInTheDocument();
    });
  });
});
