import { render, screen, waitFor } from '@testing-library/react';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/lib/env', () => ({ env: { BASE_API_URL: 'http://test-api.com' } }));

let ctx: { currentProject: { id: string } | null; projects: { id: string }[]; loading: boolean };
jest.mock('@/context/project-context', () => ({ useProjectContext: () => ctx }));

import { SearchOpportunitiesRedirect } from '@/components/opportunities/SearchOpportunitiesRedirect';

describe('org-level search route redirects to the canonical project page', () => {
  beforeEach(() => { jest.clearAllMocks(); window.history.replaceState({}, '', '/?q=radar&source=DIBBS'); });

  it('prefers the remembered current project', async () => {
    ctx = { currentProject: { id: 'proj-current' }, projects: [{ id: 'proj-first' }], loading: false };
    render(<SearchOpportunitiesRedirect orgId="org-1" />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockReplace.mock.calls[0][0]).toContain('/projects/proj-current/search-opportunities');
  });

  it('preserves the query string so bookmarked searches still run', async () => {
    ctx = { currentProject: { id: 'p1' }, projects: [], loading: false };
    render(<SearchOpportunitiesRedirect orgId="org-1" />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockReplace.mock.calls[0][0]).toContain('q=radar');
  });

  it('falls back to the first project when none is remembered', async () => {
    ctx = { currentProject: null, projects: [{ id: 'proj-first' }], loading: false };
    render(<SearchOpportunitiesRedirect orgId="org-1" />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockReplace.mock.calls[0][0]).toContain('proj-first');
  });

  it('carries the saved-searches sub-path', async () => {
    ctx = { currentProject: { id: 'p1' }, projects: [], loading: false };
    render(<SearchOpportunitiesRedirect orgId="org-1" subPath="saved-searches" />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockReplace.mock.calls[0][0]).toContain('/search-opportunities/saved-searches');
  });

  it('guides the user instead of redirecting when the org has no projects', async () => {
    ctx = { currentProject: null, projects: [], loading: false };
    render(<SearchOpportunitiesRedirect orgId="org-1" />);
    expect(await screen.findByText(/Create a project first/i)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('waits while projects are still loading', () => {
    ctx = { currentProject: null, projects: [], loading: true };
    render(<SearchOpportunitiesRedirect orgId="org-1" />);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
