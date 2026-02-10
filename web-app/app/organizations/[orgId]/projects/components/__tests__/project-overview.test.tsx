import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { ProjectOverview } from '../project-overview';

// Mock Next.js Link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid="next-link">{children}</a>
  );
});

// Mock date-fns
jest.mock('date-fns', () => ({
  format: jest.fn((date, formatStr) => 'Jan 1, 2025'),
  formatDistanceToNow: jest.fn((date, options) => '20 days ago'),
}));

// Mock the hooks
const mockProject = {
  id: 'project-123',
  name: 'Test Project',
  description: 'A test project description',
  orgId: 'org-456',
  status: 'In Progress',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-20T00:00:00Z',
  agencyName: 'Test Agency',
  solicitationNumber: 'SOL-123',
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

jest.mock('@/lib/hooks/use-project-outcome', () => ({
  useProjectOutcome: jest.fn(() => ({
    outcome: { status: 'pending' },
    isLoading: false,
  })),
}));

jest.mock('@/lib/hooks/use-executive-brief', () => ({
  useGetExecutiveBriefByProject: jest.fn(() => ({
    trigger: jest.fn().mockResolvedValue({ ok: true, brief: { sections: {} } }),
    isMutating: false,
  })),
}));

jest.mock('@/lib/hooks/use-foia-requests', () => ({
  useFOIARequests: jest.fn(() => ({
    foiaRequests: [],
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

jest.mock('@/components/foia/FOIARequestCard', () => ({
  FOIARequestCard: () => <div data-testid="foia-request-card">FOIA Request Card</div>,
}));

// Mock UI components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild) {
      return <>{children}</>;
    }
    return <button {...props}>{children}</button>;
  },
}));

jest.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: { value: number }) => <div data-testid="progress" data-value={value}></div>,
}));

jest.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton"></div>,
}));

describe('ProjectOverview', () => {
  const defaultProps = {
    projectId: 'project-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders project name', async () => {
    await act(async () => {
      render(<ProjectOverview {...defaultProps} />);
    });
    
    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  it('renders navigation links to project sections', async () => {
    await act(async () => {
      render(<ProjectOverview {...defaultProps} />);
    });

    await waitFor(() => {
      // Check that navigation links to project sections exist
      const briefLink = screen.getAllByRole('link').find(link => 
        link.getAttribute('href')?.includes('/brief')
      );
      expect(briefLink).toBeInTheDocument();
      expect(briefLink).toHaveAttribute('href', '/organizations/org-456/projects/project-123/brief');
    });
  });

  it('renders back arrow icon', async () => {
    const { container } = render(<ProjectOverview {...defaultProps} />);
    
    await waitFor(() => {
      // ArrowLeft icon should be present
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  it('displays project description when available', async () => {
    await act(async () => {
      render(<ProjectOverview {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('A test project description')).toBeInTheDocument();
    });
  });

  it('shows question completion metrics', async () => {
    await act(async () => {
      render(<ProjectOverview {...defaultProps} />);
    });

    await waitFor(() => {
      // Should show "1/2" for answered/total questions
      expect(screen.getByText('1/2')).toBeInTheDocument();
      // Should show 50% complete
      expect(screen.getByText('50% complete')).toBeInTheDocument();
    });
  });
});