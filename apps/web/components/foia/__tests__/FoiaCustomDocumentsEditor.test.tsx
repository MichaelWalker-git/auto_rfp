import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoiaCustomDocumentsEditor } from '../FoiaCustomDocumentsEditor';
import { useUpdateFoiaCustomDocuments } from '@/lib/hooks/use-foia-artifacts';

jest.mock('@/lib/hooks/use-foia-artifacts');

const mockToast = jest.fn();
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockUseUpdate = useUpdateFoiaCustomDocuments as jest.MockedFunction<
  typeof useUpdateFoiaCustomDocuments
>;

const defaultProps = {
  orgId: 'org-1',
  projectId: 'proj-1',
  oppId: 'opp-1',
  customDocumentRequests: undefined,
  onSaved: jest.fn(),
};

describe('FoiaCustomDocumentsEditor', () => {
  const mockUpdate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockReset().mockResolvedValue('re-rendered letter');
    mockUseUpdate.mockReturnValue({
      updateCustomDocuments: mockUpdate,
      isSaving: false,
    });
  });

  const open = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /add specific documents/i }));
    return user;
  };

  it('starts collapsed and shows the stored count', () => {
    render(
      <FoiaCustomDocumentsEditor
        {...defaultProps}
        customDocumentRequests={['Section 4.3 worksheets', 'Bid tabulation']}
      />,
    );

    expect(screen.getByRole('button', { name: /additional documents \(2\)/i })).toBeInTheDocument();
  });

  it('adds an entry and saves it', async () => {
    render(<FoiaCustomDocumentsEditor {...defaultProps} />);
    const user = await open();

    await user.type(
      screen.getByPlaceholderText(/section 4.3/i),
      'Bid tabulation including SB preference computations',
    );
    await user.click(screen.getByRole('button', { name: '' }).closest('button')!);

    await user.click(screen.getByRole('button', { name: /save and re-generate/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        customDocumentRequests: ['Bid tabulation including SB preference computations'],
      });
    });
  });

  it('adds an entry on Enter', async () => {
    render(<FoiaCustomDocumentsEditor {...defaultProps} />);
    const user = await open();

    await user.type(screen.getByPlaceholderText(/section 4.3/i), 'Consensus worksheets{Enter}');

    expect(screen.getByText('Consensus worksheets')).toBeInTheDocument();
  });

  it('removes an entry', async () => {
    render(
      <FoiaCustomDocumentsEditor {...defaultProps} customDocumentRequests={['Remove me']} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /additional documents \(1\)/i }));

    expect(screen.getByText('Remove me')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove document request 1/i }));

    expect(screen.queryByText('Remove me')).not.toBeInTheDocument();
  });

  it('disables save until something changes', async () => {
    render(<FoiaCustomDocumentsEditor {...defaultProps} customDocumentRequests={['Existing']} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /additional documents \(1\)/i }));

    expect(screen.getByRole('button', { name: /save and re-generate/i })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/section 4.3/i), 'New one{Enter}');

    expect(screen.getByRole('button', { name: /save and re-generate/i })).toBeEnabled();
  });

  it('saves an empty list to clear the entries', async () => {
    render(<FoiaCustomDocumentsEditor {...defaultProps} customDocumentRequests={['Clear me']} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /additional documents \(1\)/i }));

    await user.click(screen.getByRole('button', { name: /remove document request 1/i }));
    await user.click(screen.getByRole('button', { name: /save and re-generate/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ customDocumentRequests: [] }),
      );
    });
  });

  it('refetches after a successful save', async () => {
    const onSaved = jest.fn();
    render(<FoiaCustomDocumentsEditor {...defaultProps} onSaved={onSaved} />);
    const user = await open();

    await user.type(screen.getByPlaceholderText(/section 4.3/i), 'Something{Enter}');
    await user.click(screen.getByRole('button', { name: /save and re-generate/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  /**
   * A failed save must not close the panel or drop the reviewer's typing — losing a
   * carefully-worded request to a transient 409 is the fastest way to make someone
   * stop using the feature.
   */
  it('keeps the entries and the panel open when the save fails', async () => {
    mockUpdate.mockRejectedValue(new Error('already been sent'));
    const onSaved = jest.fn();
    render(<FoiaCustomDocumentsEditor {...defaultProps} onSaved={onSaved} />);
    const user = await open();

    await user.type(screen.getByPlaceholderText(/section 4.3/i), 'Keep me{Enter}');
    await user.click(screen.getByRole('button', { name: /save and re-generate/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });

    expect(screen.getByText('Keep me')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('discards edits on cancel', async () => {
    render(<FoiaCustomDocumentsEditor {...defaultProps} customDocumentRequests={['Original']} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /additional documents \(1\)/i }));

    await user.type(screen.getByPlaceholderText(/section 4.3/i), 'Discarded{Enter}');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    // Reopening shows only the stored value.
    await user.click(screen.getByRole('button', { name: /additional documents \(1\)/i }));
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.queryByText('Discarded')).not.toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not add blank entries', async () => {
    render(<FoiaCustomDocumentsEditor {...defaultProps} />);
    const user = await open();

    await user.type(screen.getByPlaceholderText(/section 4.3/i), '   {Enter}');

    expect(screen.getByRole('button', { name: /save and re-generate/i })).toBeDisabled();
  });

  it('stops at 25 entries and explains why', async () => {
    render(
      <FoiaCustomDocumentsEditor
        {...defaultProps}
        customDocumentRequests={Array.from({ length: 25 }, (_, i) => `doc ${i}`)}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /additional documents \(25\)/i }));

    expect(screen.getByPlaceholderText(/section 4.3/i)).toBeDisabled();
    expect(screen.getByText(/unduly burdensome/i)).toBeInTheDocument();
  });

  it('shows a spinner while saving', async () => {
    mockUseUpdate.mockReturnValue({ updateCustomDocuments: mockUpdate, isSaving: true });
    render(<FoiaCustomDocumentsEditor {...defaultProps} customDocumentRequests={['x']} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /additional documents \(1\)/i }));

    expect(screen.getByRole('button', { name: /save and re-generate/i })).toBeDisabled();
  });
});
