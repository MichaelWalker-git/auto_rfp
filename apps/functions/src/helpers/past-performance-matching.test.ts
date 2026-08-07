const mockMatchProjectsToRequirements = jest.fn();
const mockPerformGapAnalysis = jest.fn();
const mockTrackPastProjectUsage = jest.fn();
jest.mock('@/helpers/past-performance', () => ({
  matchProjectsToRequirements: (...args: unknown[]) => mockMatchProjectsToRequirements(...args),
  performGapAnalysis: (...args: unknown[]) => mockPerformGapAnalysis(...args),
  trackPastProjectUsage: (...args: unknown[]) => mockTrackPastProjectUsage(...args),
}));

const mockGetExecutiveBrief = jest.fn();
const mockLoadSolicitationForBrief = jest.fn();
const mockMarkSectionInProgress = jest.fn();
const mockMarkSectionComplete = jest.fn();
const mockMarkSectionFailed = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  getExecutiveBrief: (...args: unknown[]) => mockGetExecutiveBrief(...args),
  loadSolicitationForBrief: (...args: unknown[]) => mockLoadSolicitationForBrief(...args),
  markSectionInProgress: (...args: unknown[]) => mockMarkSectionInProgress(...args),
  markSectionComplete: (...args: unknown[]) => mockMarkSectionComplete(...args),
  markSectionFailed: (...args: unknown[]) => mockMarkSectionFailed(...args),
  buildSectionInputHash: jest.fn(() => 'test-hash'),
  truncateText: (text: string) => text,
}));

const mockGetProjectById = jest.fn();
jest.mock('@/helpers/project', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}));

import {
  ensurePastPerformanceForScoring,
  generateNarrativeSummary,
  PastPerformanceMatchingError,
  runPastPerformanceMatching,
} from './past-performance-matching';
import type { ExecutiveBriefItem, GapAnalysis, PastProjectMatch } from '@auto-rfp/core';

const makeMatch = (overrides: { relevanceScore?: number; title?: string; projectId?: string } = {}) =>
  ({
    project: {
      projectId: overrides.projectId ?? 'pp-1',
      title: overrides.title ?? 'Cloud Migration',
    },
    relevanceScore: overrides.relevanceScore ?? 85,
    matchDetails: {},
    matchedRequirements: [],
    narrative: null,
  }) as unknown as PastProjectMatch;

const makeGapAnalysis = (overrides: Partial<GapAnalysis> = {}): GapAnalysis => ({
  coverageItems: [],
  overallCoverage: 80,
  criticalGaps: [],
  recommendations: [],
  ...overrides,
});

const makeBrief = (overrides: Record<string, unknown> = {}): ExecutiveBriefItem =>
  ({
    projectId: 'proj-1',
    orgId: 'org-1',
    opportunityId: 'opp-1',
    allTextKeys: ['k1'],
    documentsBucket: 'bucket',
    status: 'IN_PROGRESS',
    sections: {
      summary: { status: 'COMPLETE', data: { summary: 'A summary of the RFP.' } },
      requirements: {
        status: 'COMPLETE',
        data: {
          requirements: [
            { category: 'TECH', requirement: 'Build a web app' },
            { category: null, requirement: 'Provide support' },
          ],
        },
      },
      pastPerformance: { status: 'IDLE' },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as unknown as ExecutiveBriefItem;

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadSolicitationForBrief.mockResolvedValue({ solicitationText: 'solicitation text', textKeys: ['k1'] });
  mockMatchProjectsToRequirements.mockResolvedValue([makeMatch()]);
  mockPerformGapAnalysis.mockResolvedValue(makeGapAnalysis());
  mockTrackPastProjectUsage.mockResolvedValue(undefined);
  mockMarkSectionInProgress.mockResolvedValue(undefined);
  mockMarkSectionComplete.mockResolvedValue(undefined);
  mockMarkSectionFailed.mockResolvedValue(undefined);
});

describe('runPastPerformanceMatching', () => {
  it('runs matching and persists the pastPerformance section (happy path)', async () => {
    const brief = makeBrief();
    mockGetExecutiveBrief.mockResolvedValue(brief);

    const result = await runPastPerformanceMatching({ executiveBriefId: 'brief-1' });

    expect(result.cached).toBe(false);
    expect(result.pastPerformance.topMatches).toHaveLength(1);
    expect(result.pastPerformance.narrativeSummary).toContain('Found 1 relevant past performance project');
    expect(mockMatchProjectsToRequirements).toHaveBeenCalledWith(
      'org-1',
      ['Build a web app', 'Provide support'],
      'solicitation text',
      5,
    );
    expect(mockTrackPastProjectUsage).toHaveBeenCalledWith('org-1', 'pp-1', 'brief-1');
    expect(mockMarkSectionInProgress).toHaveBeenCalledWith(
      expect.objectContaining({ executiveBriefId: 'brief-1', section: 'pastPerformance' }),
    );
    expect(mockMarkSectionComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        executiveBriefId: 'brief-1',
        section: 'pastPerformance',
        data: expect.objectContaining({ topMatches: expect.any(Array) }),
      }),
    );
  });

  it('is idempotent: returns cached data when section already COMPLETE and force is not set', async () => {
    const cachedData = { topMatches: [], narrativeSummary: 'cached', evidence: [] };
    const brief = makeBrief({
      sections: {
        ...makeBrief().sections,
        pastPerformance: { status: 'COMPLETE', data: cachedData },
      },
    });
    mockGetExecutiveBrief.mockResolvedValue(brief);

    const result = await runPastPerformanceMatching({ executiveBriefId: 'brief-1' });

    expect(result.cached).toBe(true);
    expect(result.pastPerformance).toEqual(cachedData);
    expect(mockMatchProjectsToRequirements).not.toHaveBeenCalled();
    expect(mockMarkSectionInProgress).not.toHaveBeenCalled();
  });

  it('re-runs matching when force=true even if section is COMPLETE', async () => {
    const brief = makeBrief({
      sections: {
        ...makeBrief().sections,
        pastPerformance: { status: 'COMPLETE', data: { topMatches: [], evidence: [] } },
      },
    });
    mockGetExecutiveBrief.mockResolvedValue(brief);

    const result = await runPastPerformanceMatching({ executiveBriefId: 'brief-1', force: true });

    expect(result.cached).toBe(false);
    expect(mockMatchProjectsToRequirements).toHaveBeenCalled();
  });

  it('uses the provided brief without re-reading it', async () => {
    const brief = makeBrief();

    await runPastPerformanceMatching({ executiveBriefId: 'brief-1', orgId: 'org-1', brief });

    expect(mockGetExecutiveBrief).not.toHaveBeenCalled();
    expect(mockGetProjectById).not.toHaveBeenCalled();
  });

  it('resolves orgId from the project SK when brief and project lack orgId', async () => {
    const brief = makeBrief({ orgId: null });
    mockGetExecutiveBrief.mockResolvedValue(brief);
    mockGetProjectById.mockResolvedValue({ sort_key: 'org-from-sk#proj-1' });

    await runPastPerformanceMatching({ executiveBriefId: 'brief-1' });

    expect(mockMatchProjectsToRequirements).toHaveBeenCalledWith(
      'org-from-sk',
      expect.any(Array),
      expect.any(String),
      5,
    );
  });

  it('throws PastPerformanceMatchingError when project is not found', async () => {
    mockGetExecutiveBrief.mockResolvedValue(makeBrief({ orgId: null }));
    mockGetProjectById.mockResolvedValue(null);

    await expect(runPastPerformanceMatching({ executiveBriefId: 'brief-1' })).rejects.toThrow(
      PastPerformanceMatchingError,
    );
  });

  it('falls back to the summary when no requirements are extracted', async () => {
    const brief = makeBrief({
      sections: {
        summary: { status: 'COMPLETE', data: { summary: 'A summary of the RFP.' } },
        requirements: { status: 'COMPLETE', data: { requirements: [] } },
        pastPerformance: { status: 'IDLE' },
      },
    });
    mockGetExecutiveBrief.mockResolvedValue(brief);

    await runPastPerformanceMatching({ executiveBriefId: 'brief-1' });

    expect(mockMatchProjectsToRequirements).toHaveBeenCalledWith(
      'org-1',
      ['A summary of the RFP.'],
      expect.any(String),
      5,
    );
  });

  it('marks the section FAILED and rethrows when matching fails', async () => {
    mockGetExecutiveBrief.mockResolvedValue(makeBrief());
    mockMatchProjectsToRequirements.mockRejectedValue(new Error('pinecone down'));

    await expect(runPastPerformanceMatching({ executiveBriefId: 'brief-1' })).rejects.toThrow('pinecone down');
    expect(mockMarkSectionFailed).toHaveBeenCalledWith(
      expect.objectContaining({ executiveBriefId: 'brief-1', section: 'pastPerformance' }),
    );
  });

  it('computes confidenceScore from coverage, matches, and gaps', async () => {
    mockGetExecutiveBrief.mockResolvedValue(makeBrief());
    mockPerformGapAnalysis.mockResolvedValue(makeGapAnalysis({ overallCoverage: 100, criticalGaps: [] }));

    const result = await runPastPerformanceMatching({ executiveBriefId: 'brief-1' });

    // 100 * 0.7 + 20 (matches) + 10 (no critical gaps) = 100
    expect(result.pastPerformance.confidenceScore).toBe(100);
  });
});

describe('ensurePastPerformanceForScoring', () => {
  it('returns existing section data without running matching', async () => {
    const cachedData = { topMatches: [], narrativeSummary: 'cached', evidence: [] };
    const brief = makeBrief({
      sections: { ...makeBrief().sections, pastPerformance: { status: 'COMPLETE', data: cachedData } },
    });

    const result = await ensurePastPerformanceForScoring({
      executiveBriefId: 'brief-1',
      orgId: 'org-1',
      brief,
    });

    expect(result).toEqual(cachedData);
    expect(mockMatchProjectsToRequirements).not.toHaveBeenCalled();
  });

  it('runs matching when section is not complete', async () => {
    const brief = makeBrief();

    const result = await ensurePastPerformanceForScoring({
      executiveBriefId: 'brief-1',
      orgId: 'org-1',
      brief,
    });

    expect(result?.topMatches).toHaveLength(1);
    expect(mockMatchProjectsToRequirements).toHaveBeenCalled();
  });

  it('returns undefined (non-blocking) when matching fails', async () => {
    mockMatchProjectsToRequirements.mockRejectedValue(new Error('boom'));
    const brief = makeBrief();

    const result = await ensurePastPerformanceForScoring({
      executiveBriefId: 'brief-1',
      orgId: 'org-1',
      brief,
    });

    expect(result).toBeUndefined();
  });
});

describe('generateNarrativeSummary', () => {
  it('describes the strongest match when meaningful matches exist', () => {
    const summary = generateNarrativeSummary([makeMatch({ relevanceScore: 90, title: 'ERP Rollout' })], makeGapAnalysis());
    expect(summary).toContain('"ERP Rollout"');
    expect(summary).toContain('90% relevance score');
  });

  it('reports no relevant matches when scores are below threshold', () => {
    const summary = generateNarrativeSummary([makeMatch({ relevanceScore: 10 })], null);
    expect(summary).toContain('No relevant past performance projects were found');
    expect(summary).toContain('1 project(s) were reviewed');
  });

  it('mentions critical gaps from gap analysis', () => {
    const summary = generateNarrativeSummary(
      [makeMatch({ relevanceScore: 80 })],
      makeGapAnalysis({ criticalGaps: ['gap-a', 'gap-b'] }),
    );
    expect(summary).toContain('2 critical gap(s) identified');
  });
});
