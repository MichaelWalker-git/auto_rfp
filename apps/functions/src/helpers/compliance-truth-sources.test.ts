// Mock all I/O dependencies before importing the module under test.
jest.mock('@/helpers/db', () => ({ getItem: jest.fn() }));
jest.mock('@/helpers/embeddings', () => ({ getEmbedding: jest.fn() }));
jest.mock('@/helpers/company-profile', () => ({ getCompanyProfile: jest.fn() }));
jest.mock('@/helpers/semantic-search', () => ({
  semanticSearchContentLibrary: jest.fn(),
  semanticSearchPastPerformance: jest.fn(),
}));
jest.mock('@/helpers/past-performance', () => ({
  getPastProject: jest.fn(),
  searchPastProjects: jest.fn(),
  listAllPastProjects: jest.fn(),
}));
jest.mock('@/helpers/generate-document-worker', () => ({
  loadApprovedSolutionPlanContext: jest.fn(),
}));

import {
  loadCompanyFacts,
  searchKnowledgeBase,
  isKbItemUsable,
  loadCertRecords,
  searchPastPerformanceUsable,
  listWithheldClientNames,
  loadSolutionPlanFacts,
} from './compliance-truth-sources';
import { getItem } from '@/helpers/db';
import { getEmbedding } from '@/helpers/embeddings';
import { getCompanyProfile } from '@/helpers/company-profile';
import { semanticSearchContentLibrary } from '@/helpers/semantic-search';
import { getPastProject, searchPastProjects, listAllPastProjects } from '@/helpers/past-performance';
import { loadApprovedSolutionPlanContext } from '@/helpers/generate-document-worker';

const mockGetItem = getItem as jest.Mock;
const mockGetEmbedding = getEmbedding as jest.Mock;
const mockGetCompanyProfile = getCompanyProfile as jest.Mock;
const mockSearchCL = semanticSearchContentLibrary as jest.Mock;
const mockGetPastProject = getPastProject as jest.Mock;
const mockSearchPastProjects = searchPastProjects as jest.Mock;
const mockListAllPastProjects = listAllPastProjects as jest.Mock;
const mockLoadPlanContext = loadApprovedSolutionPlanContext as jest.Mock;

const kbItem = (over: Record<string, unknown> = {}) => ({
  id: 'kb-1',
  orgId: 'org-1',
  question: 'Do you hold ISO 27001?',
  answer: 'Yes, valid through 2027.',
  category: 'Certifications',
  approvalStatus: 'APPROVED',
  isArchived: false,
  freshnessStatus: 'ACTIVE',
  ...over,
});

const project = (over: Record<string, unknown> = {}) => ({
  projectId: 'p-1',
  orgId: 'org-1',
  title: 'Acme Data Modernization',
  client: 'Acme Corp',
  clientPOC: { name: 'Jane Doe', organization: 'Acme Corp' },
  contractNumber: 'C-12345',
  value: 5_000_000,
  description: 'Modernized Acme Corp systems.',
  achievements: [],
  technologies: [],
  naicsCodes: [],
  isArchived: false,
  disclosure: 'NAMEABLE',
  disclosureConfirmed: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEmbedding.mockResolvedValue([0.1, 0.2]);
});

describe('loadCompanyFacts', () => {
  it('returns the profile on success', async () => {
    mockGetCompanyProfile.mockResolvedValue({ orgId: 'org-1', companyName: 'HorusTech' });
    expect(await loadCompanyFacts('org-1')).toEqual({ orgId: 'org-1', companyName: 'HorusTech' });
  });

  it('fails open to null', async () => {
    mockGetCompanyProfile.mockRejectedValue(new Error('boom'));
    expect(await loadCompanyFacts('org-1')).toBeNull();
  });
});

describe('isKbItemUsable — APPROVED/ACTIVE hard-gate', () => {
  it('accepts APPROVED, active, non-archived', () => {
    expect(isKbItemUsable(kbItem() as never)).toBe(true);
  });

  it.each([
    ['DRAFT', { approvalStatus: 'DRAFT' }],
    ['DEPRECATED', { approvalStatus: 'DEPRECATED' }],
    ['archived', { isArchived: true }],
    ['STALE', { freshnessStatus: 'STALE' }],
    ['ARCHIVED freshness', { freshnessStatus: 'ARCHIVED' }],
  ])('rejects %s', (_label, over) => {
    expect(isKbItemUsable(kbItem(over) as never)).toBe(false);
  });
});

describe('searchKnowledgeBase', () => {
  it('returns only gated KB hits', async () => {
    mockSearchCL.mockResolvedValue([
      { source: { sort_key: 'org-1#kb-1' }, score: 0.9 },
      { source: { sort_key: 'org-1#kb-2' }, score: 0.7 },
    ]);
    mockGetItem
      .mockResolvedValueOnce(kbItem({ id: 'kb-1' }))
      .mockResolvedValueOnce(kbItem({ id: 'kb-2', approvalStatus: 'DRAFT' }));

    const hits = await searchKnowledgeBase('org-1', 'ISO 27001', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].itemId).toBe('kb-1');
  });

  it('returns [] on empty query without calling embeddings', async () => {
    expect(await searchKnowledgeBase('org-1', '   ', 5)).toEqual([]);
    expect(mockGetEmbedding).not.toHaveBeenCalled();
  });

  it('fails open to [] on search error', async () => {
    mockSearchCL.mockRejectedValue(new Error('pinecone down'));
    expect(await searchKnowledgeBase('org-1', 'ISO', 5)).toEqual([]);
  });
});

describe('loadCertRecords', () => {
  it('merges gated KB cert hits and profile CERTIFICATION fields', async () => {
    mockSearchCL.mockResolvedValue([{ source: { sort_key: 'org-1#kb-1' }, score: 0.9 }]);
    mockGetItem.mockResolvedValue(kbItem({ category: 'Certifications' }));
    mockGetCompanyProfile.mockResolvedValue({
      orgId: 'org-1',
      fields: [
        { key: 'iso', label: 'ISO 9001', category: 'CERTIFICATION', verified: true, expiresAt: '2030-01-01' },
        { key: 'other', label: 'Website', category: 'CONTACT', verified: true },
      ],
      smallBusinessCertId: '8(a)-123',
      smallBusinessCertExpiration: '2028-06-01',
    });

    const records = await loadCertRecords('org-1', 'ISO 9001');
    const labels = records.map((r) => r.label);
    expect(labels).toContain('ISO 9001');
    expect(labels).toContain('8(a)-123');
    // Non-certification profile field excluded.
    expect(labels).not.toContain('Website');
  });

  it('propagates the KB item certExpiryDate onto the KB cert record via the real Pinecone SK (D4; legacy 3-part SK)', async () => {
    // Use a LEGACY 3-part SK (orgId#kbId#itemId) from Pinecone — the exact case a
    // reconstructed `${orgId}#${itemId}` guess would miss. The expiry must still
    // ride along because it's read from the item loaded via this real SK.
    const legacySk = 'org-1#kb-legacy#itm-1';
    mockSearchCL.mockResolvedValue([{ source: { sort_key: legacySk }, score: 0.9 }]);
    mockGetItem.mockResolvedValue(kbItem({ category: 'Certifications', certExpiryDate: '2024-01-01T00:00:00.000Z' }));
    mockGetCompanyProfile.mockResolvedValue(null);

    const records = await loadCertRecords('org-1', 'ISO 27001');
    const kbRecord = records.find((r) => r.source === 'kb');
    expect(kbRecord).toBeTruthy();
    // Before the fix this was hardcoded null, so an expired KB cert could never be flagged.
    expect(kbRecord?.expiresAt).toBe('2024-01-01T00:00:00.000Z');
    // The item is loaded with the Pinecone-returned SK, not a reconstructed 2-part one.
    expect(mockGetItem).toHaveBeenCalledWith('CONTENT_LIBRARY', legacySk);
  });

  it('fails open to [] when everything throws', async () => {
    mockSearchCL.mockRejectedValue(new Error('x'));
    mockGetCompanyProfile.mockRejectedValue(new Error('y'));
    expect(await loadCertRecords('org-1', 'ISO')).toEqual([]);
  });
});

describe('searchPastPerformanceUsable', () => {
  it('drops DO_NOT_USE and redacts non-NAMEABLE client names', async () => {
    mockSearchPastProjects.mockResolvedValue([
      { projectId: 'p-nameable', score: 0.9 },
      { projectId: 'p-anon', score: 0.8 },
      { projectId: 'p-donotuse', score: 0.7 },
    ]);
    mockGetPastProject.mockImplementation(async (_org: string, id: string) => {
      if (id === 'p-nameable') return project({ projectId: 'p-nameable' });
      if (id === 'p-anon')
        return project({
          projectId: 'p-anon',
          disclosure: 'ANONYMIZED_ONLY',
          disclosureConfirmed: true,
        });
      return project({ projectId: 'p-donotuse', disclosure: 'DO_NOT_USE', disclosureConfirmed: true });
    });

    const facts = await searchPastPerformanceUsable('org-1', 'data modernization', 5);
    const ids = facts.map((f) => f.projectId);
    expect(ids).toContain('p-nameable');
    expect(ids).toContain('p-anon');
    expect(ids).not.toContain('p-donotuse');

    const anon = facts.find((f) => f.projectId === 'p-anon')!;
    // Redacted: real client name never surfaces; contractNumber nulled.
    expect(anon.client).not.toContain('Acme Corp');
    expect(anon.contractNumber).toBeNull();
  });

  it('fails open to [] on error', async () => {
    mockSearchPastProjects.mockRejectedValue(new Error('down'));
    expect(await searchPastPerformanceUsable('org-1', 'x', 5)).toEqual([]);
  });
});

describe('listWithheldClientNames', () => {
  it('collects client + POC strings only for non-NAMEABLE projects', async () => {
    mockListAllPastProjects.mockResolvedValue([
      project({ projectId: 'p-nameable', client: 'Public Client', disclosure: 'NAMEABLE', disclosureConfirmed: true }),
      project({
        projectId: 'p-anon',
        client: 'Secret Client',
        clientPOC: { name: 'John POC', organization: 'Secret Org' },
        disclosure: 'ANONYMIZED_ONLY',
        disclosureConfirmed: true,
      }),
      // Fail-closed: unconfirmed → treated as PERMISSION_REQUIRED → withheld.
      project({ projectId: 'p-unconfirmed', client: 'Pending Client', disclosureConfirmed: false }),
    ]);

    const withheld = await listWithheldClientNames('org-1');
    const names = withheld.map((w) => w.name);
    expect(names).toContain('Secret Client');
    expect(names).toContain('John POC');
    expect(names).toContain('Secret Org');
    expect(names).toContain('Pending Client');
    // NAMEABLE project's client is never withheld.
    expect(names).not.toContain('Public Client');
  });

  it('fails open to [] on error', async () => {
    mockListAllPastProjects.mockRejectedValue(new Error('scan failed'));
    expect(await listWithheldClientNames('org-1')).toEqual([]);
  });
});

describe('loadSolutionPlanFacts', () => {
  const planContext = (over: Record<string, unknown> = {}) => ({
    plan: {
      id: 'plan-1',
      version: 3,
      isStale: false,
      costSchedule: {
        currency: 'USD',
        items: [
          { label: 'AWS Hosting', amount: 5000, billing: 'MONTHLY', category: 'THIRD_PARTY', optional: false },
          { label: 'Migration', amount: 120000, billing: 'ONE_TIME', category: 'LABOR', optional: false },
          // null-amount item ("vendor quote required") must be dropped.
          { label: 'Optional Add-on', amount: null, billing: 'MONTHLY', category: 'OTHER', optional: true },
        ],
        oneTimeTotal: 120000,
        ongoingAnnualTotal: 60000,
      },
      ...(over.plan as Record<string, unknown> ?? {}),
    },
    text: (over.text as string) ?? 'Solution Architecture. Team of 5 engineers. AWS-based approach.',
  });

  it('returns text + priced cost lines from a READY plan, dropping null-amount lines', async () => {
    mockLoadPlanContext.mockResolvedValue(planContext());
    const facts = await loadSolutionPlanFacts('org-1', 'proj-1', 'opp-1');
    expect(mockLoadPlanContext).toHaveBeenCalledWith({ orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' });
    expect(facts).not.toBeNull();
    expect(facts!.planId).toBe('plan-1');
    expect(facts!.version).toBe(3);
    expect(facts!.currency).toBe('USD');
    expect(facts!.text).toContain('Team of 5 engineers');
    expect(facts!.costItems.map((c) => c.label)).toEqual(['AWS Hosting', 'Migration']);
    expect(facts!.costItems.every((c) => typeof c.amount === 'number')).toBe(true);
  });

  it('returns a stale-but-READY plan (staleness never blocks the check)', async () => {
    mockLoadPlanContext.mockResolvedValue(planContext({ plan: { id: 'plan-1', version: 4, isStale: true } }));
    const facts = await loadSolutionPlanFacts('org-1', 'proj-1', 'opp-1');
    expect(facts!.isStale).toBe(true);
  });

  it('returns null when there is no READY plan (context null)', async () => {
    mockLoadPlanContext.mockResolvedValue(null);
    expect(await loadSolutionPlanFacts('org-1', 'proj-1', 'opp-1')).toBeNull();
  });

  it('handles a plan with no cost schedule → empty costItems, default currency', async () => {
    mockLoadPlanContext.mockResolvedValue({
      plan: { id: 'plan-1', version: 1, isStale: false, costSchedule: null },
      text: 'Approach only.',
    });
    const facts = await loadSolutionPlanFacts('org-1', 'proj-1', 'opp-1');
    expect(facts!.costItems).toEqual([]);
    expect(facts!.currency).toBe('USD');
  });

  it('fails open to null on error (loader throws — e.g. missing contentKey)', async () => {
    mockLoadPlanContext.mockRejectedValue(new Error('READY but no contentKey'));
    expect(await loadSolutionPlanFacts('org-1', 'proj-1', 'opp-1')).toBeNull();
  });

  it('projects FILLED planTeam lines into teamMembers, dropping UNFILLED and DELETED lines (C6c)', async () => {
    mockLoadPlanContext.mockResolvedValue(
      planContext({
        plan: {
          id: 'plan-1',
          version: 5,
          isStale: false,
          costSchedule: null,
          planTeam: {
            members: [
              // FILLED — kept
              { employeeId: 'e1', nameSnapshot: 'Jane Doe', role: 'Project Manager', removedEmployee: false },
              // DELETED-employee — dropped (no live assignment to check against)
              { nameSnapshot: 'Gone Person', role: 'Architect', removedEmployee: true },
              // UNFILLED — dropped (open role, no person)
              { role: 'DevOps Lead', removedEmployee: false },
              // FILLED — kept
              { employeeId: 'e2', nameSnapshot: 'John Smith', role: 'Lead Engineer', removedEmployee: false },
            ],
          },
        },
      }),
    );
    const facts = await loadSolutionPlanFacts('org-1', 'proj-1', 'opp-1');
    expect(facts!.teamMembers).toEqual([
      { name: 'Jane Doe', role: 'Project Manager' },
      { name: 'John Smith', role: 'Lead Engineer' },
    ]);
  });

  it('returns empty teamMembers when the plan has no planTeam', async () => {
    mockLoadPlanContext.mockResolvedValue(planContext());
    const facts = await loadSolutionPlanFacts('org-1', 'proj-1', 'opp-1');
    expect(facts!.teamMembers).toEqual([]);
  });
});
