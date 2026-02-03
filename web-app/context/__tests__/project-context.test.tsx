import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { ProjectProvider, useProjectContext } from '../project-context';

// Mock next/navigation
const mockPush = jest.fn();
const mockPathname = '/organizations/org-123/projects/deleted-project-id/dashboard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
  }),
  usePathname: () => mockPathname,
}));

// Mock organization context
jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({
    currentOrganization: { id: 'org-123', name: 'Test Org' },
  }),
}));

// Mock useProjects hook - returns list without the "deleted" project
const mockProjects = [
  { id: 'project-1', name: 'Project 1', orgId: 'org-123' },
  { id: 'project-2', name: 'Project 2', orgId: 'org-123' },
];

jest.mock('@/lib/hooks/use-api', () => ({
  useProjects: () => ({
    data: mockProjects,
    mutate: jest.fn(),
    isLoading: false,
  }),
}));

// Test component that uses the context
function TestConsumer() {
  const { currentProject, projects } = useProjectContext();
  return (
    <div>
      <span data-testid="current-project">{currentProject?.id ?? 'none'}</span>
      <span data-testid="projects-count">{projects.length}</span>
    </div>
  );
}

describe('ProjectContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear localStorage
    localStorage.clear();
  });

  it('redirects to projects list when selected project no longer exists', async () => {
    // The pathname indicates we're viewing "deleted-project-id" but it's not in the projects list
    render(
      <ProjectProvider>
        <TestConsumer />
      </ProjectProvider>
    );

    await waitFor(() => {
      // Should redirect to projects list, NOT to first project
      expect(mockPush).toHaveBeenCalledWith('/organizations/org-123/projects');
    });

    // Should NOT redirect to first project's dashboard
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.stringContaining('/projects/project-1/dashboard')
    );
  });
});
