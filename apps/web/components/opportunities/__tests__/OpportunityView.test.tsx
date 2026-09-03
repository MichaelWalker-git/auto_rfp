import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── nuqs (ESM) — plain React state seeded from a per-test initial `?tab=` ──────
// Mirrors components/organizations/__tests__/PromptManager.test.tsx.
let initialTab: string | null = null;
jest.mock('nuqs', () => ({
  parseAsStringLiteral: (values: readonly string[]) => ({
    withDefault: (defaultValue: string) => ({ values, defaultValue }),
  }),
  useQueryState: (_key: string, parser: { values: readonly string[]; defaultValue: string }) => {
    const seed =
      initialTab && parser.values.includes(initialTab) ? initialTab : parser.defaultValue;
    return React.useState(seed);
  },
}));

// ─── swr (useSmartPolling) ──────────────────────────────────────────────────────
jest.mock('swr', () => ({
  useSWRConfig: () => ({ mutate: jest.fn() }),
}));

// ─── Progress engine: mock the hook; faithfully stub the strip ───────────────────
const mockUseOpportunityProgress = jest.fn();
jest.mock('@/features/opportunity-progress', () => ({
  useOpportunityProgress: (...args: unknown[]) => mockUseOpportunityProgress(...args),
  evaluateRelated: (items: unknown[] | null | undefined) => {
    const count = Array.isArray(items) ? items.length : 0;
    return { count, label: `${count} related` };
  },
  navigateToStep: (nav: { kind: string; href?: string }, selectTab: (k: string) => void) => {
    if (nav.kind === 'route' && nav.href) selectTab(nav.href);
  },
  ProgressTabStrip: ({
    tabs,
    activeKey,
    onNavigate,
  }: {
    tabs: Array<{
      key: string;
      label: string;
      navigation: unknown;
      step?: { status: string; detailText: string };
      metricText?: string;
    }>;
    activeKey: string;
    onNavigate: (nav: unknown) => void;
  }) => (
    <div role="tablist" aria-label="Opportunity tabs">
      {tabs.map((t) => {
        const metric = t.step ? t.step.detailText : t.metricText;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === activeKey}
            aria-label={[t.label, t.step?.status, metric].filter(Boolean).join(', ')}
            onClick={() => onNavigate(t.navigation)}
          >
            {t.label}
            {metric ? ` — ${metric}` : ''}
          </button>
        );
      })}
    </div>
  ),
}));

// ─── Context / org / data-hook seams ─────────────────────────────────────────────
const mockUseOpportunityContext = jest.fn();
jest.mock('../opportunity-context', () => ({
  OpportunityProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useOpportunityContext: () => mockUseOpportunityContext(),
}));

const mockUseCurrentOrganization = jest.fn();
jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => mockUseCurrentOrganization(),
}));

const mockUseQuestionFiles = jest.fn();
jest.mock('@/lib/hooks/use-question-file', () => ({
  useQuestionFiles: () => mockUseQuestionFiles(),
}));

const mockUseRelatedRfps = jest.fn();
jest.mock('@/features/related-rfp', () => ({
  useRelatedRfps: (...args: unknown[]) => mockUseRelatedRfps(...args),
  RelatedRfpsSection: () => <div data-testid="body-related">Related RFPs</div>,
}));

jest.mock('@/lib/utils/opportunity-selection', () => ({ saveSelectedOpportunity: jest.fn() }));

// notary chip label — deterministic so the notary chip renders when a summary exists
jest.mock('@/features/required-forms/lib/notary-ui', () => ({
  notaryChipLabel: (s: unknown) => (s ? 'Notary: 1' : null),
}));

// ─── Child panel stubs (each has its own tests) ──────────────────────────────────
jest.mock('../opportunity-header', () => ({
  OpportunityHeader: () => <div data-testid="opp-header">Header card</div>,
}));
jest.mock('../AssigneeSelector', () => ({ AssigneeSelector: () => <div data-testid="assignee" /> }));
jest.mock('../opportunity-attachments', () => ({
  OpportunitySolicitationDocuments: () => <div data-testid="body-details-docs">Solicitations</div>,
}));
jest.mock('../opportunity-rfp-documents', () => ({
  OpportunityRFPDocuments: () => <div data-testid="body-rfp-documents">RFP docs</div>,
}));
jest.mock('../OpportunityChatDialog', () => ({ OpportunityChatDialog: () => <div data-testid="chat" /> }));
jest.mock('../PhysicalSubmissionBanner', () => ({
  PhysicalSubmissionBanner: () => <div data-testid="physical-banner" />,
}));
jest.mock('../opportunity-context-panel', () => ({
  OpportunityContextPanel: () => <div data-testid="context-panel" />,
}));
jest.mock('../opportunity-outcome-summary', () => ({
  OpportunityOutcomeSummary: () => <div data-testid="body-outcome">Outcome</div>,
}));
jest.mock('@/components/brief/ExecutiveBriefView', () => ({
  ExecutiveBriefView: () => <div data-testid="body-analysis">Brief</div>,
}));
jest.mock('@/app/organizations/[orgId]/projects/[projectId]/questions/components', () => ({
  QuestionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/debriefing', () => ({ DebriefingCard: () => <div /> }));
jest.mock('@/components/foia', () => ({
  FOIARequestCard: () => <div />,
  FoiaAutomationCard: () => <div />,
}));
jest.mock('@/features/proposal-submission', () => ({
  SubmitProposalButton: () => <div />,
  SubmissionHistoryCard: () => <div />,
  ComplianceReport: () => <div data-testid="body-compliance">Compliance report</div>,
}));
jest.mock('@/features/required-forms', () => ({
  RequiredFormsList: () => <div data-testid="body-required-forms">Required forms</div>,
}));
jest.mock('@/features/compliance-review', () => ({
  ComplianceReviewPanel: () => <div data-testid="body-review">Review</div>,
}));
jest.mock('@/features/solution-plan', () => ({
  SolutionPlanPanel: () => <div data-testid="body-solution-plan">Solution plan</div>,
}));
jest.mock('@/features/opportunity-approval', () => ({
  OpportunityApprovalPanel: () => <div data-testid="approval-banner" />,
}));
jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { OpportunityView } from '../OpportunityView';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const route = (href: string) => ({ kind: 'route', href });

const step = (href: string, detailText = '1 of 1', status = 'complete') => ({
  stepId: href,
  status,
  detailText,
  label: href,
  navigation: route(href),
  visible: true,
});

/** All seven progress steps present (their tabKeys map to tab keys). */
const allSteps = () => [
  step('details', '2 of 3 processed'),
  step('analysis', '8 of 8 sections'),
  step('solution-plan'),
  step('required-forms', '1 of 2 filled'),
  step('rfp-documents', '1 of 1 required'),
  step('review', '0 open findings'),
  step('compliance', '80% pass rate'),
];

const baseOpportunity = () => ({
  status: 'PURSUING',
  title: 'Cyber Range RFP',
  organizationName: 'GSA',
  submissionMethod: 'ELECTRONIC',
  notarySummary: null,
});

interface Overrides {
  steps?: ReturnType<typeof step>[];
  enableSolutionPlan?: boolean;
  enableComplianceReview?: boolean;
  opportunity?: Record<string, unknown>;
  related?: unknown[];
  outcome?: { label: string; isTerminal: boolean };
}

const setup = (o: Overrides = {}) => {
  mockUseOpportunityProgress.mockReturnValue({
    steps: o.steps ?? allSteps(),
    isLoading: false,
    outcome: o.outcome ?? { label: 'Awaiting outcome', isTerminal: false },
  });
  mockUseCurrentOrganization.mockReturnValue({
    currentOrganization: {
      id: 'org1',
      enableSolutionPlan: o.enableSolutionPlan ?? true,
      enableComplianceReview: o.enableComplianceReview ?? true,
    },
  });
  mockUseOpportunityContext.mockReturnValue({
    projectId: 'p1',
    oppId: 'o1',
    orgId: 'org1',
    opportunity: { ...baseOpportunity(), ...(o.opportunity ?? {}) },
    isLoading: false,
    refetch: jest.fn(),
  });
  mockUseQuestionFiles.mockReturnValue({ items: [], isLoading: false });
  mockUseRelatedRfps.mockReturnValue({ items: o.related ?? [] });
};

const renderView = () => render(<OpportunityView projectId="p1" oppId="o1" />);

beforeEach(() => {
  jest.clearAllMocks();
  initialTab = null;
});

const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('OpportunityView — tab shell', () => {
  it('defaults to the Details tab and mounts only its body', () => {
    setup();
    renderView();

    expect(tab(/^Details,/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('body-details-docs')).toBeInTheDocument();
    // Un-opened tabs are not mounted (lazy keep-alive).
    expect(screen.queryByTestId('body-analysis')).not.toBeInTheDocument();
  });

  it('opens the tab named by `?tab=`', () => {
    initialTab = 'analysis';
    setup();
    renderView();

    expect(tab(/^Analysis,/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('body-analysis')).toBeInTheDocument();
  });

  it('falls back to Details for a `?tab=` pointing at a gated/hidden tab', () => {
    initialTab = 'solution-plan';
    setup({ enableSolutionPlan: false, steps: allSteps().filter((s) => s.stepId !== 'solution-plan') });
    renderView();

    expect(screen.queryByRole('tab', { name: /^Solution plan,/ })).not.toBeInTheDocument();
    expect(tab(/^Details,/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('body-details-docs')).toBeInTheDocument();
  });

  it('renders the always-on tabs', () => {
    setup();
    renderView();
    expect(tab(/^Details,/)).toBeInTheDocument();
    expect(tab(/^Analysis,/)).toBeInTheDocument();
    expect(tab(/^RFP docs,/)).toBeInTheDocument();
    expect(tab(/^Compliance,/)).toBeInTheDocument();
    expect(tab(/^Outcome,/)).toBeInTheDocument();
  });

  it('hides Solution plan / Review when their steps are absent (org flags off)', () => {
    setup({
      enableSolutionPlan: false,
      enableComplianceReview: false,
      steps: allSteps().filter((s) => s.stepId !== 'solution-plan' && s.stepId !== 'review'),
    });
    renderView();

    expect(screen.queryByRole('tab', { name: /^Solution plan,/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Review,/ })).not.toBeInTheDocument();
  });

  it('hides Required forms when there is no required-forms step', () => {
    setup({ steps: allSteps().filter((s) => s.stepId !== 'required-forms') });
    renderView();
    expect(screen.queryByRole('tab', { name: /^Forms,/ })).not.toBeInTheDocument();
  });

  it('shows Related only for a HigherGov opportunity with related items', () => {
    setup({ opportunity: { higherGovOppKey: 'HG-1' }, related: [{ id: 'r1' }, { id: 'r2' }] });
    renderView();
    expect(tab(/^Related opportunities, 2 related/)).toBeInTheDocument();
  });

  it('hides Related for a non-HigherGov opportunity even with items', () => {
    setup({ related: [{ id: 'r1' }] });
    renderView();
    expect(screen.queryByRole('tab', { name: /^Related opportunities/ })).not.toBeInTheDocument();
  });

  it('renders each tab header metric from the progress steps', () => {
    setup();
    renderView();
    expect(tab(/^Details, complete, 2 of 3 processed/)).toBeInTheDocument();
    expect(tab(/^Analysis, complete, 8 of 8 sections/)).toBeInTheDocument();
    expect(tab(/^Outcome, Awaiting outcome/)).toBeInTheDocument();
  });

  it('keeps a tab body mounted after switching away (lazy keep-alive)', () => {
    setup();
    renderView();

    fireEvent.click(tab(/^Analysis,/));
    expect(screen.getByTestId('body-analysis')).toBeInTheDocument();

    fireEvent.click(tab(/^Details,/));
    // Analysis body remains in the DOM even though Details is active again.
    expect(screen.getByTestId('body-analysis')).toBeInTheDocument();
    expect(tab(/^Details,/)).toHaveAttribute('aria-selected', 'true');
  });

  it('always renders the approval banner above the tabs', () => {
    setup();
    renderView();
    expect(screen.getByTestId('approval-banner')).toBeInTheDocument();
  });
});

describe('OpportunityView — requirement flag chips', () => {
  it('shows the US-team chip only for US_ONLY and jumps to Details', () => {
    initialTab = 'analysis';
    setup({ opportunity: { deliveryLocationConstraint: 'US_ONLY' } });
    renderView();

    const chip = screen.getByRole('button', { name: 'US-based team required' });
    fireEvent.click(chip);

    expect(tab(/^Details,/)).toHaveAttribute('aria-selected', 'true');
  });

  it('does not restate the US-team fact in the Details body', () => {
    setup({ opportunity: { deliveryLocationConstraint: 'US_ONLY' } });
    renderView();
    // Exactly one mention — the header chip (the Details body no longer repeats it).
    expect(screen.getAllByText('US-based team required')).toHaveLength(1);
  });

  it('shows the Physical chip only when physical and jumps to Compliance details', () => {
    initialTab = 'analysis';
    setup({ opportunity: { submissionMethod: 'PHYSICAL' } });
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Physical submission required' }));
    expect(tab(/^Compliance,/)).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the Notary chip only when a summary exists and jumps to Required forms', () => {
    initialTab = 'analysis';
    setup({ opportunity: { notarySummary: { anyNotaryRequired: true, requiredCount: 1, possiblyRequiredCount: 0 } } });
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Notary required' }));
    expect(tab(/^Forms,/)).toHaveAttribute('aria-selected', 'true');
  });

  it('hides the Notary chip when there is no Required forms tab to jump to', () => {
    // A notary flag with zero detected required forms hides the Required forms
    // tab; the chip would otherwise dead-end back to Details.
    setup({
      steps: allSteps().filter((s) => s.stepId !== 'required-forms'),
      opportunity: { notarySummary: { anyNotaryRequired: true, requiredCount: 1, possiblyRequiredCount: 0 } },
    });
    renderView();

    expect(screen.queryByRole('tab', { name: /^Forms,/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notary required' })).not.toBeInTheDocument();
  });

  it('renders no chips when none apply', () => {
    setup();
    renderView();
    expect(screen.queryByTestId('requirement-flag-row')).not.toBeInTheDocument();
  });
});
