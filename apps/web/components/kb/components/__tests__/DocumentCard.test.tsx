import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentCard } from '../DocumentCard';
import type { DocumentItem } from '@auto-rfp/core';
import type { DocumentRenameResult } from '../DocumentNameEditor';

let mockHasPermission = true;

jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  usePermission: () => mockHasPermission,
}));

const mockDoc: DocumentItem = {
  id: 'doc-1',
  knowledgeBaseId: 'kb-1',
  name: 'Technical Proposal.pdf',
  fileKey: 'org/kb/doc-1.pdf',
  textFileKey: 'org/kb/doc-1.txt',
  indexStatus: 'INDEXED',
  createdAt: '2025-01-15T00:00:00.000Z',
  updatedAt: '2025-01-15T00:00:00.000Z',
  createdBy: 'other-user-sub',
};

describe('DocumentCard', () => {
  const defaultProps = {
    doc: mockDoc,
    userSub: 'current-user-sub',
    onDelete: jest.fn(),
    onDownload: jest.fn(),
    onRename: jest.fn<Promise<DocumentRenameResult>, [DocumentItem, string]>(),
    isDeleting: false,
    isDownloading: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHasPermission = true;
  });

  it('shows the Download button when the user has document:read', () => {
    render(<DocumentCard {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Download Technical Proposal.pdf/i })).toBeInTheDocument();
  });

  it('hides the Download button when the user lacks document:read, regardless of ownership', () => {
    mockHasPermission = false;
    render(<DocumentCard {...defaultProps} />);
    expect(screen.queryByRole('button', { name: /Download Technical Proposal.pdf/i })).not.toBeInTheDocument();
  });

  it('shows the Download button even when the current user is not the document owner', () => {
    render(<DocumentCard {...defaultProps} doc={{ ...mockDoc, createdBy: 'someone-else' }} userSub="current-user-sub" />);
    expect(screen.getByRole('button', { name: /Download Technical Proposal.pdf/i })).toBeInTheDocument();
  });

  it('shows the rename (pencil) icon when the user has document:edit', () => {
    render(<DocumentCard {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Rename Technical Proposal.pdf/i })).toBeInTheDocument();
  });

  it('hides the rename (pencil) icon when the user lacks document:edit', () => {
    mockHasPermission = false;
    render(<DocumentCard {...defaultProps} />);
    expect(screen.queryByRole('button', { name: /Rename Technical Proposal.pdf/i })).not.toBeInTheDocument();
  });

  it('renames the document: click pencil, edit, press Enter, calls onRename with the trimmed name', async () => {
    const user = userEvent.setup();
    const onRename = jest.fn<Promise<DocumentRenameResult>, [DocumentItem, string]>().mockResolvedValue({ outcome: 'saved' });
    render(<DocumentCard {...defaultProps} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: /Rename Technical Proposal.pdf/i }));
    const input = screen.getByRole('textbox', { name: /document name/i });
    await user.clear(input);
    await user.type(input, '  Renamed Proposal.pdf  ');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onRename).toHaveBeenCalledWith(mockDoc, 'Renamed Proposal.pdf'));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /document name/i })).not.toBeInTheDocument());
  });

  it('rejects an empty name client-side without calling onRename', async () => {
    const user = userEvent.setup();
    const onRename = jest.fn<Promise<DocumentRenameResult>, [DocumentItem, string]>();
    render(<DocumentCard {...defaultProps} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: /Rename Technical Proposal.pdf/i }));
    const input = screen.getByRole('textbox', { name: /document name/i });
    await user.clear(input);
    await user.keyboard('{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent('Document name is required.');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name client-side without calling onRename', async () => {
    const user = userEvent.setup();
    const onRename = jest.fn<Promise<DocumentRenameResult>, [DocumentItem, string]>();
    render(<DocumentCard {...defaultProps} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: /Rename Technical Proposal.pdf/i }));
    const input = screen.getByRole('textbox', { name: /document name/i });
    await user.clear(input);
    await user.type(input, '   ');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent('Document name is required.');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('surfaces a 409 duplicate-name response inline without closing the editor', async () => {
    const user = userEvent.setup();
    const onRename = jest.fn<Promise<DocumentRenameResult>, [DocumentItem, string]>().mockResolvedValue({
      outcome: 'duplicate',
      message: 'A document with this name already exists in this knowledge base.',
    });
    render(<DocumentCard {...defaultProps} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: /Rename Technical Proposal.pdf/i }));
    const input = screen.getByRole('textbox', { name: /document name/i });
    await user.clear(input);
    await user.type(input, 'Duplicate.pdf');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'A document with this name already exists in this knowledge base.',
      ),
    );
    expect(screen.getByRole('textbox', { name: /document name/i })).toBeInTheDocument();
  });

  it('cancels on Escape without calling onRename', async () => {
    const user = userEvent.setup();
    const onRename = jest.fn<Promise<DocumentRenameResult>, [DocumentItem, string]>();
    render(<DocumentCard {...defaultProps} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: /Rename Technical Proposal.pdf/i }));
    const input = screen.getByRole('textbox', { name: /document name/i });
    await user.type(input, ' extra text');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('textbox', { name: /document name/i })).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it('commits on blur (tabbing away), like Enter', async () => {
    const user = userEvent.setup();
    const onRename = jest.fn<Promise<DocumentRenameResult>, [DocumentItem, string]>().mockResolvedValue({ outcome: 'saved' });
    render(<DocumentCard {...defaultProps} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: /Rename Technical Proposal.pdf/i }));
    const input = screen.getByRole('textbox', { name: /document name/i });
    await user.clear(input);
    await user.type(input, 'Renamed via blur.pdf');
    await user.tab();

    await waitFor(() => expect(onRename).toHaveBeenCalledWith(mockDoc, 'Renamed via blur.pdf'));
  });

  it('blurring without changing the name closes the editor without calling onRename', async () => {
    const user = userEvent.setup();
    const onRename = jest.fn<Promise<DocumentRenameResult>, [DocumentItem, string]>();
    render(<DocumentCard {...defaultProps} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: /Rename Technical Proposal.pdf/i }));
    await user.tab();

    await waitFor(() => expect(screen.queryByRole('textbox', { name: /document name/i })).not.toBeInTheDocument());
    expect(onRename).not.toHaveBeenCalled();
  });
});
