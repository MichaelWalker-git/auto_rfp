import { render, screen } from '@testing-library/react';
import { ProjectCard } from '../ProjectCard';
import { ProjectItem } from '@auto-rfp/shared';

// Mock Next.js Link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
});

describe('ProjectCard', () => {
  const mockProject: ProjectItem = {
    id: 'project-123',
    name: 'Test Project',
    description: 'A test project description',
    orgId: 'org-456',
  };

  const defaultProps = {
    project: mockProject,
    orgId: 'org-456',
  };

  it('renders project name', () => {
    render(<ProjectCard {...defaultProps} />);

    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });

  it('renders project description', () => {
    render(<ProjectCard {...defaultProps} />);

    expect(screen.getByText('A test project description')).toBeInTheDocument();
  });

  it('renders default description when not provided', () => {
    const projectWithoutDescription = {
      ...mockProject,
      description: undefined,
    };
    render(<ProjectCard project={projectWithoutDescription} orgId="org-456"/>);

    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('renders empty description as "No description"', () => {
    const projectWithEmptyDescription = {
      ...mockProject,
      description: '',
    };
    render(<ProjectCard project={projectWithEmptyDescription} orgId="org-456"/>);

    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('links to the correct project page with orgId', () => {
    render(<ProjectCard {...defaultProps} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/organizations/org-456/projects/project-123');
  });

  it('renders project card with correct styling', () => {
    const { container } = render(<ProjectCard {...defaultProps} />);

    // Card should have hover:shadow-md class
    const card = container.querySelector('[class*="hover:shadow-md"]');
    expect(card).toBeInTheDocument();
  });

  it('applies group and transition classes', () => {
    const { container } = render(<ProjectCard {...defaultProps} />);

    // Card should have group and transition classes
    const card = container.querySelector('[class*="group"][class*="transition"]');
    expect(card).toBeInTheDocument();
  });
});
