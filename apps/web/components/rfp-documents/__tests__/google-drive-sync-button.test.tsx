import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoogleDriveSyncButton } from '../google-drive-sync-button';
import type { RFPDocumentItem } from '@/lib/hooks/use-rfp-documents';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

const mockSyncTo = jest.fn();
const mockSyncFrom = jest.fn();
const mockToast = jest.fn();

jest.mock('@/lib/hooks/use-rfp-documents', () => ({
  ApiError: class ApiError extends Error {},
  useSyncRFPDocumentToGoogleDrive: () => ({ trigger: mockSyncTo }),
  useSyncRFPDocumentFromGoogleDrive: () => ({ trigger: mockSyncFrom }),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({ currentOrganization: { id: 'org-1' } }),
}));

// The permission gate has its own tests; here it would only hide the trigger and make
// every assertion below vacuous.
jest.mock('@/components/ui/permission-button', () => ({
  PermissionButton: ({
    children,
    requiredPermission: _requiredPermission,
    ...props
  }: React.ComponentProps<'button'> & { requiredPermission: string }) => (
    <button {...props}>{children}</button>
  ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeDoc = (overrides: Record<string, unknown> = {}): RFPDocumentItem =>
  ({
    documentId: 'doc-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    name: 'Technical Proposal',
    status: 'READY',
    htmlContentKey: 'orgs/org-1/doc-1/content.html',
    ...overrides,
  }) as unknown as RFPDocumentItem;

const linkedDoc = (overrides: Record<string, unknown> = {}): RFPDocumentItem =>
  makeDoc({
    googleDriveFileId: 'file-1',
    googleDriveUrl: 'https://docs.google.com/document/d/file-1/edit',
    ...overrides,
  });

const blockedDoc = (overrides: Record<string, unknown> = {}): RFPDocumentItem =>
  linkedDoc({ driveSyncStatus: 'BLOCKED_APPROVED', ...overrides });

/**
 * Renders and opens the dropdown, since every action lives inside it.
 *
 * userEvent, not fireEvent: Radix's DropdownMenu opens on a full pointerdown/pointerup
 * sequence and ignores a bare click event.
 */
const renderAndOpen = async (
  props: Partial<React.ComponentProps<typeof GoogleDriveSyncButton>> = {},
) => {
  const user = userEvent.setup();
  const onSyncComplete = jest.fn();
  render(
    <GoogleDriveSyncButton
      document={props.document ?? linkedDoc()}
      orgId="org-1"
      onSyncComplete={onSyncComplete}
      {...props}
    />,
  );
  await user.click(screen.getByRole('button'));
  return { onSyncComplete, user };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSyncTo.mockResolvedValue({ updatedExisting: true });
  mockSyncFrom.mockResolvedValue({ changed: true, versionNumber: 4, syncStatus: 'SYNCED' });
});

describe('GoogleDriveSyncButton — pull', () => {
  it('offers the pull only once the document is linked', async () => {
    const user = userEvent.setup();
    render(<GoogleDriveSyncButton document={makeDoc()} orgId="org-1" />);
    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText('Push to Google Drive')).toBeInTheDocument());
    // Without a fileId there is nothing to pull from.
    expect(screen.queryByText('Pull from Google Drive')).not.toBeInTheDocument();
  });

  it('imports and reports the new version number', async () => {
    const { onSyncComplete, user } = await renderAndOpen();

    await user.click(screen.getByText('Pull from Google Drive'));

    await waitFor(() => expect(mockSyncFrom).toHaveBeenCalledTimes(1));
    expect(mockSyncFrom).toHaveBeenCalledWith({
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      documentId: 'doc-1',
    });
    // No override on the ordinary path — the key must be absent, not false.
    expect(mockSyncFrom.mock.calls[0]![0]).not.toHaveProperty('acceptApprovedOverride');

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Synced from Google Drive',
          description: expect.stringContaining('version 4'),
        }),
      ),
    );
    expect(onSyncComplete).toHaveBeenCalled();
  });

  it('says "Already up to date" when Drive has not moved', async () => {
    mockSyncFrom.mockResolvedValue({ changed: false, syncStatus: 'SYNCED' });
    const { user } = await renderAndOpen();

    await user.click(screen.getByText('Pull from Google Drive'));

    // changed:false is a success with zero writes — calling it "Synced" would imply a
    // new version exists.
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Already up to date' }),
      ),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('disables the pull and explains why when the editor is dirty', async () => {
    const { user } = await renderAndOpen({
      isPullDisabled: true,
      pullDisabledReason: 'Save your changes first',
    });

    expect(screen.getByText('Save your changes first')).toBeInTheDocument();
    await user.click(screen.getByText('Pull from Google Drive'));

    // An import rewrites the stored HTML, so pulling over unsaved edits loses one or the
    // other on the next Save.
    expect(mockSyncFrom).not.toHaveBeenCalled();
  });

  it('surfaces a failed import as a destructive toast', async () => {
    mockSyncFrom.mockRejectedValue(new Error(JSON.stringify({ error: 'Drive is unavailable' })));
    const { user } = await renderAndOpen();

    await user.click(screen.getByText('Pull from Google Drive'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Sync from Drive failed',
          description: 'Drive is unavailable',
          variant: 'destructive',
        }),
      ),
    );
  });
});

describe('GoogleDriveSyncButton — approved documents', () => {
  it('hides the override on a document that is not blocked', async () => {
    await renderAndOpen();
    expect(screen.queryByText(/Import anyway/)).not.toBeInTheDocument();
  });

  it('requires confirmation before reopening an approval', async () => {
    const { user } = await renderAndOpen({ document: blockedDoc() });

    expect(screen.getByText('Drive edits blocked — document approved')).toBeInTheDocument();
    await user.click(screen.getByText('Import anyway (reopens approval)'));

    // The menu click opens a dialog; it must not import on its own.
    await waitFor(() =>
      expect(screen.getByText('Import into an approved document?')).toBeInTheDocument(),
    );
    expect(mockSyncFrom).not.toHaveBeenCalled();
  });

  it('sends the override flag once confirmed', async () => {
    mockSyncFrom.mockResolvedValue({ changed: true, versionNumber: 7, overrodeApproval: true });
    const { user } = await renderAndOpen({ document: blockedDoc() });

    await user.click(screen.getByText('Import anyway (reopens approval)'));
    await waitFor(() =>
      expect(screen.getByText('Import into an approved document?')).toBeInTheDocument(),
    );
    await user.click(screen.getByText('Import and reopen approval'));

    await waitFor(() =>
      expect(mockSyncFrom).toHaveBeenCalledWith(
        expect.objectContaining({ acceptApprovedOverride: true }),
      ),
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Imported — approval reopened' }),
      ),
    );
  });

  it('cancelling the override imports nothing', async () => {
    const { user } = await renderAndOpen({ document: blockedDoc() });

    await user.click(screen.getByText('Import anyway (reopens approval)'));
    await waitFor(() =>
      expect(screen.getByText('Import into an approved document?')).toBeInTheDocument(),
    );
    await user.click(screen.getByText('Cancel'));

    expect(mockSyncFrom).not.toHaveBeenCalled();
  });
});

describe('GoogleDriveSyncButton — push conflict guard', () => {
  it('warns before overwriting Drive edits newer than the last push', async () => {
    const { user } = await renderAndOpen({
      document: linkedDoc({
        driveLastPushedAt: '2026-08-17T09:00:00.000Z',
        driveModifiedTime: '2026-08-18T11:00:00.000Z',
      }),
    });

    await user.click(screen.getByText('Update Google Doc'));

    await waitFor(() =>
      expect(screen.getByText('Overwrite newer Google Drive changes?')).toBeInTheDocument(),
    );
    expect(mockSyncTo).not.toHaveBeenCalled();

    await user.click(screen.getByText('Push anyway'));
    await waitFor(() => expect(mockSyncTo).toHaveBeenCalledTimes(1));
  });

  it('pushes straight through when Drive has not moved since the last push', async () => {
    const { user } = await renderAndOpen({
      document: linkedDoc({
        driveLastPushedAt: '2026-08-18T11:00:00.000Z',
        driveModifiedTime: '2026-08-18T11:00:00.000Z',
      }),
    });

    await user.click(screen.getByText('Update Google Doc'));

    await waitFor(() => expect(mockSyncTo).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Overwrite newer Google Drive changes?')).not.toBeInTheDocument();
  });
});
