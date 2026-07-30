// Mock middy + Sentry wrapper so importing the handler module is side-effect free.
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));

// The Linear SDK is driven through client.client.rawRequest — the raw GraphQL
// escape hatch fetchLinearRows uses. mockRawRequest returns the paged response.
const mockRawRequest = jest.fn();
jest.mock('@linear/sdk', () => ({
  LinearClient: jest.fn(() => ({ client: { rawRequest: (...args: unknown[]) => mockRawRequest(...args) } })),
}));

// DB helpers — hoisted so the full-sync tests can drive queries/deletes/puts.
const mockGetItem = jest.fn();
const mockPutItem = jest.fn();
const mockPutFullItem = jest.fn();
const mockQueryAllBySkPrefix = jest.fn();
const mockDeleteItem = jest.fn();
const mockDocSend = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: (...args: unknown[]) => mockDocSend(...args) },
  queryAllBySkPrefix: (...args: unknown[]) => mockQueryAllBySkPrefix(...args),
  deleteItem: (...args: unknown[]) => mockDeleteItem(...args),
  getItem: (...args: unknown[]) => mockGetItem(...args),
  putItem: (...args: unknown[]) => mockPutItem(...args),
  putFullItem: (...args: unknown[]) => mockPutFullItem(...args),
}));

// Secrets lookup — the sync aborts early without a key, so resolve a stub.
const mockGetApiKey = jest.fn();
jest.mock('@/helpers/api-key-storage', () => ({ getApiKey: (...args: unknown[]) => mockGetApiKey(...args) }));

// Required env is read at module load — set before importing the handler.
process.env.DB_TABLE_NAME = 'test-table';
process.env.RFP_SYNC_ORG_ID = 'org-123';
process.env.RFP_SYNC_PROJECT_ID = 'gov-contracting';
process.env.RFP_SYNC_LINEAR_ORG_ID = 'linear-org-1';
process.env.RFP_SYNC_PROJECT_NAME = 'Government Contracting';

import { PROJECT_PK } from '@/constants/organization';
import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { ensureSyncProject, syncLinearPipeline } from './sync-linear-pipeline';

beforeEach(() => {
  jest.clearAllMocks();
  // Default happy-path stubs; individual tests override as needed.
  mockGetItem.mockResolvedValue({ id: 'gov-contracting' }); // project already seeded → no putItem churn
  mockGetApiKey.mockResolvedValue('linear-key');
  mockQueryAllBySkPrefix.mockResolvedValue([]);
  mockDeleteItem.mockResolvedValue(undefined);
  mockDocSend.mockResolvedValue({});
  mockPutFullItem.mockImplementation((item: unknown) => Promise.resolve(item));
});

/** One node in the raw GraphQL issues connection. */
const issueNode = (overrides: Record<string, unknown> = {}) => ({
  identifier: 'HOR-100',
  title: 'Test RFP',
  url: 'https://linear.app/x/issue/HOR-100',
  dueDate: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  state: { name: 'In Progress' },
  assignee: { name: 'Jane' },
  creator: { name: 'John' },
  labels: { nodes: [] },
  ...overrides,
});

/** Wrap issue nodes in the single-page projects→issues envelope fetchLinearRows expects. */
const linearPage = (nodes: Array<Record<string, unknown>>) => ({
  data: {
    projects: {
      nodes: [
        {
          id: 'project-1',
          issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
        },
      ],
    },
  },
});

/** An already-synced DynamoDB record as queryAllBySkPrefix would return it. */
const existingRecord = (oppId: string, extra: Record<string, unknown> = {}) => ({
  partition_key: OPPORTUNITY_PK,
  sort_key: `org-123#gov-contracting#${oppId}`,
  ...extra,
});

/** The merged record for a given oppId as passed to putFullItem (docClient no longer used). */
const putRecordFor = (oppId: string): Record<string, unknown> | undefined =>
  mockPutFullItem.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .find((r) => r.sort_key === `org-123#gov-contracting#${oppId}`);

describe('ensureSyncProject', () => {
  it('seeds the synthetic gov-contracting project when it does not exist', async () => {
    mockGetItem.mockResolvedValue(null);

    await ensureSyncProject();

    expect(mockGetItem).toHaveBeenCalledWith(PROJECT_PK, 'org-123#gov-contracting');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockPutItem).toHaveBeenCalledWith(
      PROJECT_PK,
      'org-123#gov-contracting',
      expect.objectContaining({
        id: 'gov-contracting',
        orgId: 'org-123',
        name: 'Government Contracting',
      }),
    );
  });

  it('omits createdBy so get-projects treats it as visible to every org member', async () => {
    mockGetItem.mockResolvedValue(null);

    await ensureSyncProject();

    const [, , item] = mockPutItem.mock.calls[0];
    expect(item).not.toHaveProperty('createdBy');
  });

  it('is idempotent — does not rewrite the project when it already exists', async () => {
    mockGetItem.mockResolvedValue({ id: 'gov-contracting', orgId: 'org-123' });

    await ensureSyncProject();

    expect(mockPutItem).not.toHaveBeenCalled();
  });
});

describe('syncLinearPipeline — prune safety floor', () => {
  it('does NOT prune when a run resolves zero records but records already exist (avoids blanking the board)', async () => {
    // Fetch succeeds but every issue has a null/blank workflow state, so
    // resolveRfpStage returns null for all → records is empty. This is the
    // Linear eventual-consistency hiccup that previously wiped the whole board.
    mockRawRequest.mockResolvedValue(
      linearPage([
        issueNode({ identifier: 'HOR-100', state: null }),
        issueNode({ identifier: 'HOR-101', state: { name: '' } }),
      ]),
    );
    mockQueryAllBySkPrefix.mockResolvedValue([
      existingRecord('linear-hor-100'),
      existingRecord('linear-hor-101'),
      existingRecord('linear-hor-102'),
    ]);

    const result = await syncLinearPipeline();

    expect(mockDeleteItem).not.toHaveBeenCalled();
    expect(result).toMatchObject({ written: 0, pruned: 0, prunedSkipped: true });
  });

  it('prunes normally when the run resolves at least one record', async () => {
    // HOR-100 resolves (In Progress → inProgress); the stale existing HOR-999
    // is no longer present in the board and should be pruned.
    mockRawRequest.mockResolvedValue(linearPage([issueNode({ identifier: 'HOR-100' })]));
    mockQueryAllBySkPrefix.mockResolvedValue([
      existingRecord('linear-hor-100'), // still present → keep
      existingRecord('linear-hor-999'), // gone from board → prune
    ]);

    const result = await syncLinearPipeline();

    expect(mockDeleteItem).toHaveBeenCalledTimes(1);
    expect(mockDeleteItem).toHaveBeenCalledWith(OPPORTUNITY_PK, 'org-123#gov-contracting#linear-hor-999');
    expect(result).toMatchObject({ written: 1, pruned: 1, prunedSkipped: false });
  });

  it('does not prune (and reports no skip) when there is no prior inventory to protect', async () => {
    // A genuinely empty board with no existing records: nothing to write,
    // nothing to prune, and the safety floor is a no-op (prunedSkipped false).
    mockRawRequest.mockResolvedValue(linearPage([]));
    mockQueryAllBySkPrefix.mockResolvedValue([]);

    const result = await syncLinearPipeline();

    expect(mockDeleteItem).not.toHaveBeenCalled();
    expect(result).toMatchObject({ written: 0, pruned: 0, prunedSkipped: false });
  });

  it('proportional guard: skips the prune (and reports the skip) when the drop exceeds 50%', async () => {
    // Only 1 issue resolves, but there are 4 existing records → pruning would
    // drop 3/4 (75%). That looks like a partial fetch, not real deletions.
    mockRawRequest.mockResolvedValue(linearPage([issueNode({ identifier: 'HOR-100' })]));
    mockQueryAllBySkPrefix.mockResolvedValue([
      existingRecord('linear-hor-100'), // kept
      existingRecord('linear-hor-201'), // would prune
      existingRecord('linear-hor-202'), // would prune
      existingRecord('linear-hor-203'), // would prune
    ]);

    const result = await syncLinearPipeline();

    expect(mockDeleteItem).not.toHaveBeenCalled();
    expect(result).toMatchObject({ written: 1, pruned: 0, prunedSkipped: true });
  });
});

describe('syncLinearPipeline — incremental history merge', () => {
  it('preserves a real multi-entry approvalHistory instead of collapsing it to one entry', async () => {
    // Real user-made gate approvals already recorded by opportunity-approval.ts.
    const realApprovalHistory = [
      { from: null, to: 'INITIAL_APPROVAL', changedAt: '2026-07-01T00:00:00.000Z', changedBy: 'system', gate: 'STAGE' },
      { from: 'INITIAL_APPROVAL', to: 'I_APPROVED', changedAt: '2026-07-05T10:00:00.000Z', changedBy: 'user-brennen', gate: 'INITIAL' },
      { from: 'I_APPROVED', to: 'PRE_SUB_APPROVAL', changedAt: '2026-07-10T12:00:00.000Z', changedBy: 'user-brennen', gate: 'STAGE' },
    ];
    // Existing item is already at PRE_SUB_APPROVAL / PURSUING (matches inProgress resolve).
    mockRawRequest.mockResolvedValue(linearPage([issueNode({ identifier: 'HOR-100' })]));
    mockQueryAllBySkPrefix.mockResolvedValue([
      existingRecord('linear-hor-100', {
        createdAt: '2026-06-15T00:00:00.000Z',
        createdBy: 'user-brennen',
        status: 'PURSUING',
        approvalStatus: 'I_APPROVED', // matches inProgress → STAGE_TO_APPROVAL
        approvalHistory: realApprovalHistory,
      }),
    ]);

    await syncLinearPipeline();

    const rec = putRecordFor('linear-hor-100');
    // Unchanged approvalStatus → history preserved verbatim, NOT collapsed.
    expect(rec?.approvalHistory).toEqual(realApprovalHistory);
    // createdAt / createdBy preserved from the existing record.
    expect(rec?.createdAt).toBe('2026-06-15T00:00:00.000Z');
    expect(rec?.createdBy).toBe('user-brennen');
  });

  it('does not append a duplicate entry when the approval status is unchanged', async () => {
    mockRawRequest.mockResolvedValue(linearPage([issueNode({ identifier: 'HOR-100' })]));
    mockQueryAllBySkPrefix.mockResolvedValue([
      existingRecord('linear-hor-100', {
        status: 'PURSUING',
        approvalStatus: 'I_APPROVED',
        statusHistory: [
          { from: null, to: 'PURSUING', changedAt: '2026-07-01T00:00:00.000Z', changedBy: 'system', source: 'SYSTEM' },
        ],
        approvalHistory: [
          { from: null, to: 'I_APPROVED', changedAt: '2026-07-01T00:00:00.000Z', changedBy: 'system', gate: 'STAGE' },
        ],
      }),
    ]);

    await syncLinearPipeline();

    const rec = putRecordFor('linear-hor-100');
    expect(rec?.approvalHistory).toHaveLength(1);
    expect(rec?.statusHistory).toHaveLength(1);
  });

  it('appends exactly one entry with from=previous on a real status change', async () => {
    // Existing at INITIAL_APPROVAL/QUALIFYING; the issue now resolves inProgress
    // → I_APPROVED / PURSUING, a genuine transition.
    mockRawRequest.mockResolvedValue(linearPage([issueNode({ identifier: 'HOR-100' })]));
    mockQueryAllBySkPrefix.mockResolvedValue([
      existingRecord('linear-hor-100', {
        status: 'QUALIFYING',
        approvalStatus: 'INITIAL_APPROVAL',
        statusHistory: [
          { from: null, to: 'QUALIFYING', changedAt: '2026-07-01T00:00:00.000Z', changedBy: 'system', source: 'SYSTEM' },
        ],
        approvalHistory: [
          { from: null, to: 'INITIAL_APPROVAL', changedAt: '2026-07-01T00:00:00.000Z', changedBy: 'system', gate: 'STAGE' },
        ],
      }),
    ]);

    await syncLinearPipeline();

    const rec = putRecordFor('linear-hor-100');
    const approvalHistory = rec?.approvalHistory as Array<Record<string, unknown>>;
    const statusHistory = rec?.statusHistory as Array<Record<string, unknown>>;

    expect(approvalHistory).toHaveLength(2);
    expect(approvalHistory[1]).toMatchObject({ from: 'INITIAL_APPROVAL', to: 'I_APPROVED' });
    expect(statusHistory).toHaveLength(2);
    expect(statusHistory[1]).toMatchObject({ from: 'QUALIFYING', to: 'PURSUING' });
  });

  it('seeds a single honest from:null entry for a brand-new record', async () => {
    mockRawRequest.mockResolvedValue(linearPage([issueNode({ identifier: 'HOR-100' })]));
    mockQueryAllBySkPrefix.mockResolvedValue([]); // no existing item

    await syncLinearPipeline();

    const rec = putRecordFor('linear-hor-100');
    const approvalHistory = rec?.approvalHistory as Array<Record<string, unknown>>;
    expect(approvalHistory).toHaveLength(1);
    expect(approvalHistory[0]).toMatchObject({ from: null, to: 'I_APPROVED' });
  });

  it('leaves completedAt null for a non-terminal stage even when Linear reports one', async () => {
    // inProgress is a live stage — a stray completedAt from Linear must NOT leak
    // through, or submittedAtIso/outcome window would treat live work as closed.
    mockRawRequest.mockResolvedValue(
      linearPage([issueNode({ identifier: 'HOR-100', completedAt: '2026-07-19T00:00:00.000Z' })]),
    );
    mockQueryAllBySkPrefix.mockResolvedValue([]);

    await syncLinearPipeline();

    const rec = putRecordFor('linear-hor-100');
    expect(rec?.completedAt).toBeNull();
    expect(rec?.pipelineStage).toBe('inProgress');
  });

  it('populates completedAt and stamps the transition at completedAt for a terminal stage', async () => {
    // A submitted issue (status "Submitted") is terminal → completedAt kept, and a
    // brand-new terminal record stamps its seed entry at completedAt, not updatedAt.
    const completedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mockRawRequest.mockResolvedValue(
      linearPage([
        issueNode({
          identifier: 'HOR-100',
          state: { name: 'Submitted' },
          completedAt,
        }),
      ]),
    );
    mockQueryAllBySkPrefix.mockResolvedValue([]);

    await syncLinearPipeline();

    const rec = putRecordFor('linear-hor-100');
    expect(rec?.pipelineStage).toBe('submitted');
    expect(rec?.completedAt).toBe(completedAt);
    const approvalHistory = rec?.approvalHistory as Array<Record<string, unknown>>;
    expect(approvalHistory[0]?.changedAt).toBe(completedAt);
  });
});
