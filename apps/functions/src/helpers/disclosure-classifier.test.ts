const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

const mockListAllPastProjects = jest.fn();
const mockGetPastProject = jest.fn();
jest.mock('@/helpers/past-performance', () => ({
  listAllPastProjects: (...a: unknown[]) => mockListAllPastProjects(...a),
  getPastProject: (...a: unknown[]) => mockGetPastProject(...a),
}));

const mockQueryKb = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  queryCompanyKnowledgeBase: (...a: unknown[]) => mockQueryKb(...a),
}));

const mockLoadTextFromS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: (...a: unknown[]) => mockLoadTextFromS3(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.DOCUMENTS_BUCKET = 'docs-bucket';

import { classifyDisclosure } from './disclosure-classifier';
import type { PastProject } from '@auto-rfp/core';

const ORG = 'org-1';

const makeProject = (id: string, overrides: Partial<PastProject> = {}): PastProject =>
  ({
    projectId: id,
    orgId: ORG,
    title: `Project ${id}`,
    client: `Client ${id}`,
    description: 'A sufficiently long description.',
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
    createdBy: '33333333-3333-3333-3333-333333333333',
    ...overrides,
  }) as PastProject;

const modelReply = (rows: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(rows) }] }));

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryKb.mockResolvedValue([]);
  mockLoadTextFromS3.mockResolvedValue('');
});

describe('classifyDisclosure', () => {
  it('produces proposals for valid model rows (by projectId)', async () => {
    mockGetPastProject.mockResolvedValue(makeProject('p1'));
    mockInvokeModel.mockResolvedValue(
      modelReply([
        { projectId: 'p1', proposed: 'ANONYMIZED_ONLY', rationale: 'Client asked to remain anonymous.', signals: ['nda'], confidence: 80 },
      ]),
    );

    const result = await classifyDisclosure(ORG, ['p1']);
    expect(result.classified).toBe(1);
    expect(result.proposals[0]).toMatchObject({ projectId: 'p1', proposed: 'ANONYMIZED_ONLY', confidence: 80 });
    expect(result.failed).toEqual([]);
  });

  it('routes malformed rows (bad enum) with a projectId into failed', async () => {
    mockGetPastProject.mockResolvedValue(makeProject('p1'));
    mockInvokeModel.mockResolvedValue(
      modelReply([{ projectId: 'p1', proposed: 'MAYBE', rationale: 'x', confidence: 50 }]),
    );

    const result = await classifyDisclosure(ORG, ['p1']);
    expect(result.classified).toBe(0);
    expect(result.failed).toContain('p1');
  });

  it('skips already-proposed projects when force is false', async () => {
    mockListAllPastProjects.mockResolvedValue([
      makeProject('p1', { disclosureProposed: 'NAMEABLE' }),
    ]);

    const result = await classifyDisclosure(ORG);
    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(result.classified).toBe(0);
  });

  it('re-classifies an already-proposed project when force is true', async () => {
    mockListAllPastProjects.mockResolvedValue([
      makeProject('p1', { disclosureProposed: 'NAMEABLE' }),
    ]);
    mockInvokeModel.mockResolvedValue(
      modelReply([{ projectId: 'p1', proposed: 'DO_NOT_USE', rationale: 'NDA forbids it.', confidence: 95 }]),
    );

    const result = await classifyDisclosure(ORG, undefined, true);
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(result.proposals[0].proposed).toBe('DO_NOT_USE');
  });

  it('passes the known-blocked-list signal into the model payload', async () => {
    process.env.DISCLOSURE_BLOCKED_CLIENTS = 'Client p1';
    mockGetPastProject.mockResolvedValue(makeProject('p1', { client: 'Client p1' }));
    mockInvokeModel.mockResolvedValue(
      modelReply([{ projectId: 'p1', proposed: 'DO_NOT_USE', rationale: 'Blocked.', confidence: 99 }]),
    );

    await classifyDisclosure(ORG, ['p1']);
    const userPrompt = mockInvokeModel.mock.calls[0][1] as string;
    expect(userPrompt).toContain('KnownBlockedListHit: true');
    delete process.env.DISCLOSURE_BLOCKED_CLIENTS;
  });

  it('marks the whole batch failed when the model returns unparseable text', async () => {
    mockGetPastProject.mockResolvedValue(makeProject('p1'));
    mockInvokeModel.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: 'not json at all' }] })),
    );

    const result = await classifyDisclosure(ORG, ['p1']);
    expect(result.failed).toContain('p1');
    expect(result.classified).toBe(0);
  });

  it('marks the batch failed when invokeModel throws', async () => {
    mockGetPastProject.mockResolvedValue(makeProject('p1'));
    mockInvokeModel.mockRejectedValue(new Error('bedrock down'));

    const result = await classifyDisclosure(ORG, ['p1']);
    expect(result.failed).toContain('p1');
  });

  it('bounds concurrent Bedrock calls (never more than 4 batches in flight)', async () => {
    // 50 projects → 10 batches of 5. Without a cap all 10 model calls fire at once;
    // with the cap at most 4 are in flight simultaneously.
    const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
    mockGetPastProject.mockImplementation(async (_org: string, id: string) => makeProject(id));

    let inFlight = 0;
    let peak = 0;
    mockInvokeModel.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      // Return a single valid row (projectId doesn't matter for this assertion).
      return modelReply([{ projectId: 'p0', proposed: 'NAMEABLE', rationale: 'ok', confidence: 90 }]);
    });

    await classifyDisclosure(ORG, ids, true);

    expect(mockInvokeModel).toHaveBeenCalledTimes(10); // 50 / 5
    expect(peak).toBeGreaterThan(1); // actually parallel
    expect(peak).toBeLessThanOrEqual(4); // but bounded
  });
});
