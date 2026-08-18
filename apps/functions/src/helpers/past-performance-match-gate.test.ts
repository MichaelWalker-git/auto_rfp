/**
 * Integration test for the disclosure gate applied inside
 * matchProjectsToRequirements (leak surface #1).
 *
 * Verifies:
 *  - a DO_NOT_USE project never appears in the returned matches
 *  - an ANONYMIZED_ONLY project is matched but has its client name / POC /
 *    contract number redacted in the persisted match
 *  - a confirmed NAMEABLE project keeps its real client name
 */

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.PINECONE_INDEX = 'test-index';

// Mock embeddings — the query embedding is irrelevant to gating.
jest.mock('./embeddings', () => ({
  getEmbedding: jest.fn(async () => new Array(1024).fill(0)),
}));

// Mock Pinecone: searchPastProjects returns hits by projectId; we drive the set.
const mockQuery = jest.fn();
jest.mock('./pinecone', () => ({
  initPineconeClient: jest.fn(async () => ({
    Index: () => ({
      namespace: () => ({
        query: (...args: unknown[]) => mockQuery(...args),
        upsert: jest.fn(async () => undefined),
        deleteOne: jest.fn(async () => undefined),
      }),
    }),
  })),
}));

// Mock DynamoDB doc client: GetCommand returns the project keyed by SK.
const projectStore = new Map<string, unknown>();
const mockSend = jest.fn(async (command: { input?: { Key?: { sort_key?: string } } }) => {
  const sk = command?.input?.Key?.sort_key;
  return { Item: sk ? projectStore.get(sk) : undefined };
});
jest.mock('./db', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
}));

import { matchProjectsToRequirements } from './past-performance';
import { createPastProjectSK, type PastProject } from '@auto-rfp/core';

const ORG = 'org-1';

const makeProject = (id: string, overrides: Partial<PastProject> = {}): PastProject =>
  ({
    projectId: id,
    orgId: ORG,
    title: `Project ${id}`,
    client: `Real Client ${id}`,
    clientPOC: { name: 'POC Person' },
    contractNumber: `CN-${id}`,
    description: 'A sufficiently long description of the delivered work.',
    achievements: [],
    technologies: [],
    naicsCodes: [],
    domain: 'Healthcare',
    usageCount: 0,
    usedInBriefIds: [],
    freshnessStatus: 'ACTIVE',
    disclosure: 'PERMISSION_REQUIRED',
    disclosureConfirmed: false,
    disclosureSignals: [],
    isArchived: false,
    endDate: '2025-01-01',
    performanceRating: 5,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    createdBy: '33333333-3333-3333-3333-333333333333',
    ...overrides,
  }) as PastProject;

const seed = (project: PastProject) => {
  projectStore.set(createPastProjectSK(ORG, project.projectId), {
    partition_key: 'PAST_PROJECT',
    sort_key: createPastProjectSK(ORG, project.projectId),
    ...project,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  projectStore.clear();
});

describe('matchProjectsToRequirements disclosure gate', () => {
  it('excludes DO_NOT_USE projects from matches', async () => {
    seed(makeProject('nameable', { disclosure: 'NAMEABLE', disclosureConfirmed: true }));
    seed(makeProject('blocked', { disclosure: 'DO_NOT_USE', disclosureConfirmed: true }));

    mockQuery.mockResolvedValue({
      matches: [
        { metadata: { projectId: 'nameable' }, score: 0.9 },
        { metadata: { projectId: 'blocked' }, score: 0.9 },
      ],
    });

    const matches = await matchProjectsToRequirements(ORG, ['req'], 'healthcare solicitation', 5);
    const ids = matches.map((m) => m.project.projectId);
    expect(ids).toContain('nameable');
    expect(ids).not.toContain('blocked');
  });

  it('redacts client, POC, and contract number for ANONYMIZED_ONLY matches', async () => {
    seed(makeProject('anon', { disclosure: 'ANONYMIZED_ONLY', disclosureConfirmed: true }));
    mockQuery.mockResolvedValue({ matches: [{ metadata: { projectId: 'anon' }, score: 0.9 }] });

    const matches = await matchProjectsToRequirements(ORG, ['req'], 'healthcare solicitation', 5);
    expect(matches).toHaveLength(1);
    expect(matches[0].project.client).toBe('[Client name withheld — Healthcare engagement]');
    expect(matches[0].project.clientPOC).toBeNull();
    expect(matches[0].project.contractNumber).toBeNull();
  });

  it('redacts an unconfirmed NAMEABLE project (fail-closed)', async () => {
    seed(makeProject('pending', { disclosure: 'NAMEABLE', disclosureConfirmed: false }));
    mockQuery.mockResolvedValue({ matches: [{ metadata: { projectId: 'pending' }, score: 0.9 }] });

    const matches = await matchProjectsToRequirements(ORG, ['req'], 'healthcare solicitation', 5);
    expect(matches[0].project.client).not.toContain('Real Client');
    expect(matches[0].project.client).toContain('withheld');
  });

  it('keeps the real client name for a confirmed NAMEABLE match', async () => {
    seed(makeProject('ok', { disclosure: 'NAMEABLE', disclosureConfirmed: true }));
    mockQuery.mockResolvedValue({ matches: [{ metadata: { projectId: 'ok' }, score: 0.9 }] });

    const matches = await matchProjectsToRequirements(ORG, ['req'], 'healthcare solicitation', 5);
    expect(matches[0].project.client).toBe('Real Client ok');
    expect(matches[0].project.contractNumber).toBe('CN-ok');
  });

  it('applies the gate in the fallback-all branch when there are no semantic matches', async () => {
    seed(makeProject('blocked', { disclosure: 'DO_NOT_USE', disclosureConfirmed: true }));
    seed(makeProject('anon', { disclosure: 'ANONYMIZED_ONLY', disclosureConfirmed: true }));
    // No semantic hits → fallback to listPastProjects (a Query on the same docClient).
    mockQuery.mockResolvedValue({ matches: [] });
    mockSend.mockImplementation(async (command: { input?: { Key?: { sort_key?: string }; KeyConditionExpression?: string } }) => {
      if (command?.input?.KeyConditionExpression) {
        // listPastProjects Query
        return { Items: Array.from(projectStore.values()) };
      }
      const sk = command?.input?.Key?.sort_key;
      return { Item: sk ? projectStore.get(sk) : undefined };
    });

    const matches = await matchProjectsToRequirements(ORG, ['req'], 'healthcare solicitation', 5);
    const ids = matches.map((m) => m.project.projectId);
    expect(ids).not.toContain('blocked');
    expect(ids).toContain('anon');
    const anon = matches.find((m) => m.project.projectId === 'anon');
    expect(anon?.project.client).toContain('withheld');
  });
});
