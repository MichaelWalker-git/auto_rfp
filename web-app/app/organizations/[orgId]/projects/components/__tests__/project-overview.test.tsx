import { render, screen } from '@testing-library/react';
import { ProjectOverview } from '../project-overview';

// Mock Next.js Link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid="next-link">{children}</a>
  );
});

// Mock the hooks
const mockProject = {
  id: 'project-123',
  name: 'Test Project',
  description: 'A test project description',
  orgId: 'org-456',
  status: 'In Progress',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-20T00:00:00Z',
};

const mockQuestions = {
  sections: [
    {
      name: 'Section 1',
      questions: [
        { id: 'q1', text: 'Question 1', answer: 'Answer 1' },
        { id: 'q2', text: 'Question 2', answer: null },
      ],
    },
  ],
};

const mockQuestionFiles = [
  { questionFileId: 'qf-123', name: 'RFP.pdf' },
];

jest.mock('@/lib/hooks/use-api', () => ({
  useProject: jest.fn(() => ({
    data: mockProject,
    isLoading: false,
    error: null,
  })),
  useQuestions: jest.fn(() => ({
    data: mockQuestions,
    isLoading: false,
    error: null,
  })),
}));

jest.mock('@/app/organizations/[orgId]/projects/[projectId]/questions/components', () => ({
  useQuestions: jest.fn(() => ({
    questionFiles: mockQuestionFiles,
    isLoading: false,
    error: null,
  })),
  NoRfpDocumentAvailable: () => <div>No RFP Document</div>,
}));

jest.mock('@/components/brief/ExecutiveBriefView', () => ({
  ExecutiveBriefView: () => <div data-testid="executive-brief">Executive Brief</div>,
}));

describe('ProjectOverview', () => {
  const defaultProps = {
    projectId: 'project-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders project name', () => {
    render(<ProjectOverview {...defaultProps} />);
    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });

  it('renders back button with correct link to projects list', () => {
    render(<ProjectOverview {...defaultProps} />);

    const backButton = screen.getByRole('link', { name: /back to projects/i });
    expect(backButton).toBeInTheDocument();
    expect(backButton).toHaveAttribute('href', '/organizations/org-456/projects');
  });

  it('renders back arrow icon', () => {
    const { container } = render(<ProjectOverview {...defaultProps} />);

    // ArrowLeft icon should be present
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
