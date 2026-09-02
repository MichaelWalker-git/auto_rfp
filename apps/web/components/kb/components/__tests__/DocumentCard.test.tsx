import { render, screen } from '@testing-library/react';
import { DocumentCard } from '../DocumentCard';
import type { DocumentItem } from '@auto-rfp/core';

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
});
