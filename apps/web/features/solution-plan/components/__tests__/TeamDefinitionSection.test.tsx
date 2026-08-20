import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TeamDefinitionSection } from '../TeamDefinitionSection';
import { ApiError } from '@/lib/hooks/use-rfp-documents';
import type { PlanTeam } from '@auto-rfp/core';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

const mockUsePlanTeam = jest.fn();
jest.mock('../../hooks/usePlanTeam', () => ({
  usePlanTeam: (...args: unknown[]) => mockUsePlanTeam(...args),
  planTeamKey: () => null,
}));

const mockSavePlanTeam = jest.fn();
jest.mock('../../hooks/useSavePlanTeam', () => ({
  useSavePlanTeam: () => ({ savePlanTeam: mockSavePlanTeam, isSaving: false }),
}));

const mockRegeneratePlanTeam = jest.fn();
jest.mock('../../hooks/useRegeneratePlanTeam', () => ({
  useRegeneratePlanTeam: () => ({
    regeneratePlanTeam: mockRegeneratePlanTeam,
    isRegenerating: false,
  }),
}));

// U4: mock the hook, keep the REAL toTeamRequiredMessage so the 409 branch is exercised.
const mockUseGenerateTeamQualifications = jest.fn();
jest.mock('../../hooks/useGenerateTeamQualifications', () => ({
  ...jest.requireActual('../../hooks/useGenerateTeamQualifications'),
  useGenerateTeamQualifications: (...args: unknown[]) =>
    mockUseGenerateTeamQualifications(...args),
}));

const mockUseEmployees = jest.fn();
jest.mock('@/features/employees', () => ({
  useEmployees: (...args: unknown[]) => mockUseEmployees(...args),
}));

const mockUseStaffingPlans = jest.fn();
jest.mock('@/lib/hooks/use-pricing', () => ({
  useStaffingPlans: (...args: unknown[]) => mockUseStaffingPlans(...args),
}));

const mockToast = jest.fn();
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Permission checks need the auth context — grant everything unless a test flips it.
let grantPermissions = true;
jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    grantPermissions ? <>{children}</> : null,
}));

const mockConfirm = jest.fn();
jest.mock('@/components/ui/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    ConfirmDialog: () => null,
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeTeam = (over: Partial<PlanTeam> = {}): PlanTeam => ({
  members: [
    {
      employeeId: 'emp-1',
      nameSnapshot: 'Jane Doe',
      role: 'Project Manager',
      staffingPositionRef: 'Project Manager',
      rationale: 'PMP certified with direct federal PM experience.',
      removedEmployee: false,
      source: 'AI_RECOMMENDED',
    },
    {
      nameSnapshot: 'Gone Person',
      role: 'Senior Engineer',
      rationale: 'AWS certified match.',
      removedEmployee: true,
      source: 'AI_RECOMMENDED',
    },
    {
      role: 'Cloud Architect',
      staffingPositionRef: 'Cloud Architect',
      removedEmployee: false,
      source: 'AI_RECOMMENDED',
    },
  ],
  userModified: false,
  generatedAt: '2026-08-19T10:00:00.000Z',
  ...over,
});

const teamState = (team: PlanTeam | null, over: Record<string, unknown> = {}) => ({
  team,
  isLoading: false,
  notFound: false,
  error: undefined,
  refresh: jest.fn().mockResolvedValue(undefined),
  ...over,
});

const employees = [
  { id: 'emp-1', orgId: 'org-1', name: 'Jane Doe', primaryRoles: ['Project Manager'], secondaryRoles: [], certifications: [], source: 'MANUAL' },
  { id: 'emp-2', orgId: 'org-1', name: 'Bob Builder', primaryRoles: ['Engineer'], secondaryRoles: [], certifications: [], source: 'MANUAL' },
];

const mockGenerateTeamQualifications = jest.fn();
const qualificationsState = (over: Record<string, unknown> = {}) => ({
  generateTeamQualifications: mockGenerateTeamQualifications,
  isGenerating: false,
  teamQualificationsDocument: null,
  isDocumentsLoading: false,
  ...over,
});

const renderSection = () =>
  render(<TeamDefinitionSection orgId="org-1" projectId="proj-1" opportunityId="opp-1" />);

beforeEach(() => {
  jest.clearAllMocks();
  grantPermissions = true;
  mockUsePlanTeam.mockReturnValue(teamState(makeTeam()));
  mockUseEmployees.mockReturnValue({ employees, count: employees.length, isLoading: false });
  mockUseStaffingPlans.mockReturnValue({ data: { staffingPlans: [] } });
  mockConfirm.mockResolvedValue(true);
  mockSavePlanTeam.mockResolvedValue({ ok: true, team: makeTeam({ userModified: true }) });
  mockRegeneratePlanTeam.mockResolvedValue({ ok: true, team: makeTeam() });
  mockGenerateTeamQualifications.mockResolvedValue({
    ok: true,
    status: 'GENERATING',
    documentId: 'doc-tq-1',
  });
  mockUseGenerateTeamQualifications.mockReturnValue(qualificationsState());
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TeamDefinitionSection', () => {
  it('renders each member with person, role and rationale (W2/FR3.2)', () => {
    renderSection();

    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('Project Manager')).toBeTruthy();
    expect(screen.getByText('PMP certified with direct federal PM experience.')).toBeTruthy();
  });

  it('marks removed-employee lines rendered from snapshots (BR3.3)', () => {
    renderSection();

    expect(screen.getByText('Gone Person')).toBeTruthy();
    expect(screen.getByTestId('removed-employee-badge').textContent).toMatch(
      /removed from pool — pending replacement/i,
    );
  });

  it('renders unfilled positions as open roles without rationale (BR1.3)', () => {
    renderSection();

    expect(screen.getByTestId('unfilled-badge').textContent).toMatch(/open role/i);
    expect(screen.getByText('Cloud Architect')).toBeTruthy();
  });

  it('saves the edited team and exits edit mode (W3/BR3.1)', async () => {
    const state = teamState(makeTeam());
    mockUsePlanTeam.mockReturnValue(state);
    renderSection();

    fireEvent.click(screen.getByTestId('team-edit'));
    expect(screen.getByTestId('team-edit-table')).toBeTruthy();

    // Change a role via free text — the staffing ref must clear (BR2.1)
    const roleInputs = screen.getAllByTestId('team-role-input');
    fireEvent.change(roleInputs[0], { target: { value: 'Delivery Lead' } });

    fireEvent.click(screen.getByTestId('team-save'));

    await waitFor(() =>
      expect(mockSavePlanTeam).toHaveBeenCalledWith({
        members: expect.arrayContaining([
          expect.objectContaining({ employeeId: 'emp-1', role: 'Delivery Lead' }),
        ]),
      }),
    );
    const [{ members }] = mockSavePlanTeam.mock.calls[0];
    expect(members[0].staffingPositionRef).toBeUndefined();
    // Removed-employee line keeps its snapshot shape on save
    expect(members[1]).toMatchObject({ nameSnapshot: 'Gone Person', removedEmployee: true });
    expect(members[1].employeeId).toBeUndefined();

    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
    expect(screen.queryByTestId('team-edit-table')).toBeNull();
  });

  it('cancel discards edits without saving (BR3.1)', () => {
    renderSection();

    fireEvent.click(screen.getByTestId('team-edit'));
    fireEvent.click(screen.getByTestId('team-cancel'));

    expect(mockSavePlanTeam).not.toHaveBeenCalled();
    expect(screen.queryByTestId('team-edit-table')).toBeNull();
    expect(screen.getByTestId('team-view-table')).toBeTruthy();
  });

  it('refuses to save a line without a role', async () => {
    renderSection();

    fireEvent.click(screen.getByTestId('team-edit'));
    fireEvent.click(screen.getByTestId('team-add-member'));
    fireEvent.click(screen.getByTestId('team-save'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      ),
    );
    expect(mockSavePlanTeam).not.toHaveBeenCalled();
  });

  it('confirms before regenerating and warns when the team is user-modified (W4/BR1.2)', async () => {
    mockUsePlanTeam.mockReturnValue(teamState(makeTeam({ userModified: true })));
    renderSection();

    fireEvent.click(screen.getByTestId('team-regenerate'));

    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(/including your manual changes/i),
          variant: 'destructive',
        }),
      ),
    );
    await waitFor(() => expect(mockRegeneratePlanTeam).toHaveBeenCalled());
  });

  it('does not regenerate when the confirmation is cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    renderSection();

    fireEvent.click(screen.getByTestId('team-regenerate'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockRegeneratePlanTeam).not.toHaveBeenCalled();
  });

  it('shows the empty-pool prerequisite linking to the Team page (BR4.1)', () => {
    mockUsePlanTeam.mockReturnValue(teamState(null));
    mockUseEmployees.mockReturnValue({ employees: [], count: 0, isLoading: false });
    renderSection();

    expect(screen.getByTestId('team-empty-pool')).toBeTruthy();
    const link = screen.getByRole('link', { name: /go to the team page/i });
    expect(link.getAttribute('href')).toBe('/organizations/org-1/employees');
    // Manual assembly stays unavailable until employees exist
    expect(screen.queryByTestId('team-edit')).toBeNull();
  });

  it('shows the failure state with retry while editing stays available (BR4.2)', async () => {
    mockUsePlanTeam.mockReturnValue(teamState(makeTeam()));
    mockRegeneratePlanTeam.mockRejectedValue(
      Object.assign(new Error('Team recommendation failed.'), { status: 502 }),
    );
    renderSection();

    fireEvent.click(screen.getByTestId('team-regenerate'));

    await waitFor(() => expect(screen.getByTestId('team-generation-error')).toBeTruthy());
    // The existing team still renders and manual assembly stays available
    expect(screen.getByTestId('team-view-table')).toBeTruthy();
    expect(screen.getByTestId('team-edit')).toBeTruthy();

    // Retry re-runs matching without a new confirmation
    mockRegeneratePlanTeam.mockResolvedValue({ ok: true, team: makeTeam() });
    fireEvent.click(screen.getByTestId('team-retry'));
    await waitFor(() => expect(mockRegeneratePlanTeam).toHaveBeenCalledTimes(2));
  });

  it('hides edit and regenerate without the solution-plan edit permission (BR5.1)', () => {
    grantPermissions = false;
    renderSection();

    expect(screen.getByTestId('team-view-table')).toBeTruthy();
    expect(screen.queryByTestId('team-edit')).toBeNull();
    expect(screen.queryByTestId('team-regenerate')).toBeNull();
  });

  it('shows a skeleton while the team or pool loads', () => {
    mockUsePlanTeam.mockReturnValue(teamState(null, { isLoading: true }));
    renderSection();

    expect(screen.getByTestId('team-definition-skeleton')).toBeTruthy();
  });
});

describe('TeamDefinitionSection — Team Qualifications generation (U4)', () => {
  it('starts generation from the saved team and confirms with a toast (FR4.2)', async () => {
    renderSection();

    const button = screen.getByTestId('team-generate-qualifications');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(mockGenerateTeamQualifications).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Team Qualifications generation started' }),
      ),
    );
  });

  it('disables the action with guidance when there is no saved team (BR1.1)', () => {
    mockUsePlanTeam.mockReturnValue(teamState(null));
    renderSection();

    expect((screen.getByTestId('team-generate-qualifications') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId('team-qualifications-guidance').textContent).toMatch(
      /once the team above is saved/i,
    );
  });

  it('surfaces the 409 TEAM_REQUIRED guidance as a toast (FR4.2)', async () => {
    mockGenerateTeamQualifications.mockRejectedValue(
      new ApiError(
        JSON.stringify({ code: 'TEAM_REQUIRED', message: 'Review and save the team first.' }),
        409,
      ),
    );
    renderSection();

    fireEvent.click(screen.getByTestId('team-generate-qualifications'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Save the team first',
          description: 'Review and save the team first.',
          variant: 'destructive',
        }),
      ),
    );
  });

  it('shows the in-flight state while the document is GENERATING', () => {
    mockUseGenerateTeamQualifications.mockReturnValue(
      qualificationsState({
        isGenerating: true,
        teamQualificationsDocument: { documentId: 'doc-tq-1', documentType: 'TEAM_QUALIFICATIONS', status: 'GENERATING' },
      }),
    );
    renderSection();

    const button = screen.getByTestId('team-generate-qualifications');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toMatch(/generating team qualifications/i);
    expect(screen.queryByTestId('team-qualifications-view')).toBeNull();
  });

  it('offers a View action linking to the READY document among the plan documents (FR4.3/BR3.1)', () => {
    mockUseGenerateTeamQualifications.mockReturnValue(
      qualificationsState({
        teamQualificationsDocument: { documentId: 'doc-tq-1', documentType: 'TEAM_QUALIFICATIONS', status: 'READY' },
      }),
    );
    renderSection();

    const view = screen.getByTestId('team-qualifications-view');
    expect(view.getAttribute('href')).toBe(
      '/organizations/org-1/projects/proj-1/opportunities/opp-1/rfp-documents/doc-tq-1',
    );
  });

  it('hides the generation action without the proposal:create permission', () => {
    grantPermissions = false;
    renderSection();

    expect(screen.queryByTestId('team-generate-qualifications')).toBeNull();
  });
});
