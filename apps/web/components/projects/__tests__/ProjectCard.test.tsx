import { fireEvent, render, screen } from '@testing-library/react';
import { ProjectCard } from '../ProjectCard';
import type { ProjectListItem } from '@auto-rfp/core';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useParams: () => ({}),
}));

jest.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ permissions: ['project:edit', 'project:delete'] }),
}));

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({ currentOrganization: { id: 'org-456' } }),
}));

const mockSetCurrentProject = jest.fn();
jest.mock('@/context/project-context', () => ({
  useProjectContext: () => ({ setCurrentProject: mockSetCurrentProject }),
}));

jest.mock('@/lib/hooks/use-favorite-projects', () => ({
  useFavoriteProjects: () => ({ isFavorite: () => false, toggleFavorite: jest.fn() }),
}));

// Mock Next.js Link. onClick is forwarded so a click that bubbles up from a
// card action reaches the link handler, exactly as it would in the browser.
const linkClick = jest.fn();
jest.mock('next/link', () => {
  return ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={href}
      onClick={(e) => {
        linkClick(e);
        onClick?.(e);
      }}
    >
      {children}
    </a>
  );
});

describe('ProjectCard', () => {
  const project = {
    id: 'project-123',
    name: 'Test Project',
    description: 'A test project description',
    orgId: 'org-456',
  } as unknown as ProjectListItem;

  beforeEach(() => {
    mockPush.mockClear();
    mockSetCurrentProject.mockClear();
    linkClick.mockClear();
  });

  it('links to the project page', () => {
    render(<ProjectCard project={project} />);

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/organizations/org-456/projects/project-123',
    );
  });

  it('opens the delete flow without navigating into the project', () => {
    const onDelete = jest.fn();
    render(<ProjectCard project={project} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove project' }));

    expect(onDelete).toHaveBeenCalledWith(project);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockSetCurrentProject).not.toHaveBeenCalled();
    expect(linkClick).not.toHaveBeenCalled();
  });

  it('navigates into the project when the card body is clicked', () => {
    render(<ProjectCard project={project} onDelete={jest.fn()} />);

    fireEvent.click(screen.getByText('Test Project'));

    expect(linkClick).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/organizations/org-456/projects/project-123');
  });
});
