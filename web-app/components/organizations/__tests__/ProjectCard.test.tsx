import { render, screen } from '@testing-library/react';
import { ProjectCard } from '../ProjectCard';
import type { Project } from '@/types/project';

// Mock Next.js Link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
});

describe('ProjectCard', () => {
  const mockProject: Project = {
    id: 'project-123',
    name: 'Test Project',
    description: 'A test project description',
    orgId: 'org-456',
    status: 'In Progress',
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
    render(<ProjectCard project={projectWithoutDescription} orgId="org-456" />);

    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('renders empty description as "No description"', () => {
    const projectWithEmptyDescription = {
      ...mockProject,
      description: '',
    };
    render(<ProjectCard project={projectWithEmptyDescription} orgId="org-456" />);

    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('links to the correct project page with orgId', () => {
    render(<ProjectCard {...defaultProps} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/project/project-123?orgId=org-456');
  });

  it('renders status badge', () => {
    render(<ProjectCard {...defaultProps} />);

    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('renders default status when not provided', () => {
    const projectWithoutStatus = {
      ...mockProject,
      status: undefined,
    };
    render(<ProjectCard project={projectWithoutStatus} orgId="org-456" />);

    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('renders Completed status with different badge variant', () => {
    const completedProject = {
      ...mockProject,
      status: 'Completed',
    };
    render(<ProjectCard project={completedProject} orgId="org-456" />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders the FileText icon', () => {
    const { container } = render(<ProjectCard {...defaultProps} />);

    // Check for SVG element (lucide icons render as SVG)
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('applies hover styles to card', () => {
    const { container } = render(<ProjectCard {...defaultProps} />);

    // Card should have hover class
    const card = container.querySelector('[class*="hover:shadow-lg"]');
    expect(card).toBeInTheDocument();
  });
});
