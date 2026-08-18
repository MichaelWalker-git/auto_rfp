/**
 * Disclosure-gate coverage for answer-tools' search_past_performance tool.
 * This path feeds an LLM during answer generation, so the client name must be
 * gated: DO_NOT_USE dropped, non-NAMEABLE redacted, real name only for
 * confirmed NAMEABLE — and it must re-read DynamoDB, never trust Pinecone.
 */

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

const mockGetEmbedding = jest.fn();
jest.mock('@/helpers/embeddings', () => ({
  getEmbedding: (...a: unknown[]) => mockGetEmbedding(...a),
}));

const mockSemanticSearchPastPerformance = jest.fn();
jest.mock('@/helpers/semantic-search', () => ({
  semanticSearchChunks: jest.fn(),
  semanticSearchPastPerformance: (...a: unknown[]) => mockSemanticSearchPastPerformance(...a),
}));

const mockGetPastProject = jest.fn();
jest.mock('@/helpers/past-performance', () => ({
  getPastProject: (...a: unknown[]) => mockGetPastProject(...a),
}));

// Keep unrelated tool deps inert.
jest.mock('@/helpers/s3', () => ({ loadTextFromS3: jest.fn() }));
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  truncateText: (t: string) => t,
  loadAllSolicitationTexts: jest.fn(),
}));
jest.mock('@/helpers/db-tool-helpers', () => ({
  fetchOrganizationDetails: jest.fn(),
  fetchOrgPrimaryContact: jest.fn(),
  fetchProjectDetails: jest.fn(),
  fetchTeamMembers: jest.fn(),
  fetchContentLibraryMatches: jest.fn(),
  fetchDeadlineInfo: jest.fn(),
  logToolUsage: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/helpers/db', () => ({ getItem: jest.fn() }));

import { executeAnswerTool } from './answer-tools';
import type { PastProject } from '@auto-rfp/core';

const ORG = 'org-1';

const makeProject = (id: string, over: Partial<PastProject> = {}): PastProject =>
  ({
    projectId: id,
    orgId: ORG,
    title: `Project ${id}`,
    client: `Real Client ${id}`,
    clientPOC: { name: 'POC' },
    contractNumber: `CN-${id}`,
    description: 'A sufficiently long description of delivered work.',
    domain: 'Healthcare',
    achievements: [],
    technologies: [],
    naicsCodes: [],
    usageCount: 0,
    usedInBriefIds: [],
    freshnessStatus: 'ACTIVE',
    disclosure: 'PERMISSION_REQUIRED',
    disclosureConfirmed: false,
    disclosureSignals: [],
    isArchived: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'u1',
    ...over,
  }) as PastProject;

const runSearch = () =>
  executeAnswerTool({
    toolName: 'search_past_performance',
    toolInput: { keywords: 'cloud', limit: 3 },
    toolUseId: 'tu-1',
    orgId: ORG,
    questionId: 'q-1',
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEmbedding.mockResolvedValue(new Array(8).fill(0));
});

describe('search_past_performance disclosure gate', () => {
  it('redacts the real client name for a non-NAMEABLE project (feeds an LLM)', async () => {
    mockSemanticSearchPastPerformance.mockResolvedValue([
      { score: 0.9, source: { projectId: 'anon', client: 'Real Client anon' } },
    ]);
    mockGetPastProject.mockResolvedValue(
      makeProject('anon', { disclosure: 'ANONYMIZED_ONLY', disclosureConfirmed: true }),
    );

    const result = await runSearch();
    const text = JSON.stringify(result);
    expect(text).not.toContain('Real Client anon');
    expect(text).toContain('withheld');
    // Belt-and-suspenders: the block carries the do-not-name instruction to the LLM.
    expect(text).toContain('CONFIDENTIAL CLIENT');
    // It must re-read the authoritative record, not trust the Pinecone hit.
    expect(mockGetPastProject).toHaveBeenCalledWith(ORG, 'anon');
  });

  it('drops a DO_NOT_USE project entirely', async () => {
    mockSemanticSearchPastPerformance.mockResolvedValue([
      { score: 0.9, source: { projectId: 'blocked', client: 'Real Client blocked' } },
    ]);
    mockGetPastProject.mockResolvedValue(
      makeProject('blocked', { disclosure: 'DO_NOT_USE', disclosureConfirmed: true }),
    );

    const result = await runSearch();
    expect(JSON.stringify(result)).not.toContain('Real Client blocked');
  });

  it('keeps the real client name for a confirmed NAMEABLE project', async () => {
    mockSemanticSearchPastPerformance.mockResolvedValue([
      { score: 0.9, source: { projectId: 'ok', client: 'stale-metadata' } },
    ]);
    mockGetPastProject.mockResolvedValue(
      makeProject('ok', { client: 'Real Client ok', disclosure: 'NAMEABLE', disclosureConfirmed: true }),
    );

    const result = await runSearch();
    const text = JSON.stringify(result);
    expect(text).toContain('Real Client ok');
    // No confidentiality notice for a nameable client.
    expect(text).not.toContain('CONFIDENTIAL CLIENT');
  });

  it('redacts an unconfirmed NAMEABLE project (fail-closed)', async () => {
    mockSemanticSearchPastPerformance.mockResolvedValue([
      { score: 0.9, source: { projectId: 'pending', client: 'Real Client pending' } },
    ]);
    mockGetPastProject.mockResolvedValue(
      makeProject('pending', { disclosure: 'NAMEABLE', disclosureConfirmed: false }),
    );

    const result = await runSearch();
    expect(JSON.stringify(result)).not.toContain('Real Client pending');
  });

  it('numbers surviving entries sequentially with no gaps when a middle hit is gated out', async () => {
    // Hits a, b, c — b is DO_NOT_USE and gets dropped. Output must read [PP 1],[PP 2].
    mockSemanticSearchPastPerformance.mockResolvedValue([
      { score: 0.9, source: { projectId: 'a' } },
      { score: 0.8, source: { projectId: 'b' } },
      { score: 0.7, source: { projectId: 'c' } },
    ]);
    mockGetPastProject.mockImplementation(async (_org: string, id: string) =>
      id === 'b'
        ? makeProject('b', { disclosure: 'DO_NOT_USE', disclosureConfirmed: true })
        : makeProject(id, { disclosure: 'NAMEABLE', disclosureConfirmed: true, client: `Client ${id}` }),
    );

    const result = await runSearch();
    const content = (result as { content?: string }).content ?? '';
    expect(content).toContain('[PP 1]');
    expect(content).toContain('[PP 2]');
    expect(content).not.toContain('[PP 3]'); // b dropped → no gap, no third entry
    // Order preserved: a (0.9) before c (0.7).
    expect(content.indexOf('Client a')).toBeLessThan(content.indexOf('Client c'));
    expect(content).not.toContain('Client b');
  });
});
