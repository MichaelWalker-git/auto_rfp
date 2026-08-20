// Mock the db layer before importing the helpers.
jest.mock('@/helpers/db', () => ({
  createItem: jest.fn(),
  getItem: jest.fn(),
  putItem: jest.fn(),
  queryBySkPrefix: jest.fn(),
  updateItem: jest.fn(),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  buildImportRunSk,
  buildExtractionSnapshotSk,
  createImportRun,
  getLatestImportRun,
  completeImportRun,
  ImportRunAlreadyRunningError,
} from './employee-import';
import * as db from '@/helpers/db';
import { EMPLOYEE_IMPORT_RUN_PK } from '@/constants/employee-import';

const mockCreateItem = db.createItem as jest.MockedFunction<typeof db.createItem>;
const mockQueryBySkPrefix = db.queryBySkPrefix as jest.MockedFunction<typeof db.queryBySkPrefix>;
const mockUpdateItem = db.updateItem as jest.MockedFunction<typeof db.updateItem>;

const runDbItem = (overrides: Record<string, unknown> = {}) => ({
  partition_key: EMPLOYEE_IMPORT_RUN_PK,
  sort_key: 'org-1#run-old',
  importRunId: 'run-old',
  orgId: 'org-1',
  status: 'COMPLETED',
  documentsScanned: 3,
  cvsDetected: 1,
  employeesCreated: 1,
  employeesUpdated: 0,
  failedDocuments: [],
  triggeredBy: 'user-1',
  startedAt: '2026-08-19T09:00:00.000Z',
  completedAt: '2026-08-19T09:05:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SK builders', () => {
  it('build org-scoped keys with # separators', () => {
    expect(buildImportRunSk('org-1', 'run-1')).toBe('org-1#run-1');
    expect(buildExtractionSnapshotSk('org-1', 'emp-1')).toBe('org-1#emp-1');
  });
});

describe('createImportRun (BR1.1 single-run guard)', () => {
  it('creates a RUNNING run when no run is in flight', async () => {
    mockQueryBySkPrefix.mockResolvedValue([runDbItem()]);
    mockCreateItem.mockImplementation(async (_pk, sk, item) => ({
      partition_key: EMPLOYEE_IMPORT_RUN_PK,
      sort_key: sk,
      ...(item as Record<string, unknown>),
    }));

    const run = await createImportRun('org-1', 'user-1');

    expect(run.status).toBe('RUNNING');
    expect(run.orgId).toBe('org-1');
    expect(run.triggeredBy).toBe('user-1');
    expect(mockCreateItem).toHaveBeenCalledWith(
      EMPLOYEE_IMPORT_RUN_PK,
      `org-1#${run.importRunId}`,
      expect.objectContaining({ status: 'RUNNING', failedDocuments: [] }),
    );
  });

  it('refuses with ImportRunAlreadyRunningError while a run is RUNNING, pointing at it', async () => {
    const running = runDbItem({
      importRunId: 'run-live',
      sort_key: 'org-1#run-live',
      status: 'RUNNING',
      startedAt: '2026-08-19T10:00:00.000Z',
      completedAt: undefined,
    });
    mockQueryBySkPrefix.mockResolvedValue([runDbItem(), running]);

    await expect(createImportRun('org-1', 'user-1')).rejects.toMatchObject({
      name: 'ImportRunAlreadyRunningError',
      runningRun: expect.objectContaining({ importRunId: 'run-live', status: 'RUNNING' }),
    });
    expect(mockCreateItem).not.toHaveBeenCalled();
  });

  it('exposes the error class for handler instanceof checks', async () => {
    mockQueryBySkPrefix.mockResolvedValue([
      runDbItem({ importRunId: 'run-live', status: 'RUNNING', startedAt: '2026-08-19T10:00:00.000Z' }),
    ]);
    await expect(createImportRun('org-1', 'user-1')).rejects.toBeInstanceOf(
      ImportRunAlreadyRunningError,
    );
  });
});

describe('getLatestImportRun', () => {
  it('returns the most recent run by startedAt and strips db keys', async () => {
    mockQueryBySkPrefix.mockResolvedValue([
      runDbItem({ importRunId: 'run-a', startedAt: '2026-08-18T10:00:00.000Z' }),
      runDbItem({ importRunId: 'run-b', startedAt: '2026-08-19T10:00:00.000Z' }),
      runDbItem({ importRunId: 'run-c', startedAt: '2026-08-17T10:00:00.000Z' }),
    ]);

    const latest = await getLatestImportRun('org-1');

    expect(latest?.importRunId).toBe('run-b');
    expect(latest).not.toHaveProperty('partition_key');
    expect(latest).not.toHaveProperty('sort_key');
  });

  it('returns null when the org has never imported', async () => {
    mockQueryBySkPrefix.mockResolvedValue([]);
    expect(await getLatestImportRun('org-1')).toBeNull();
  });
});

describe('completeImportRun (BR4.1/BR4.2)', () => {
  it('closes the run with terminal status, counts and completedAt', async () => {
    mockUpdateItem.mockImplementation(async (_pk, sk, patch) => ({
      ...runDbItem({ sort_key: sk }),
      ...(patch as Record<string, unknown>),
    }));

    const run = await completeImportRun('org-1', 'run-1', {
      status: 'COMPLETED_WITH_ERRORS',
      documentsScanned: 10,
      failedDocuments: [{ documentName: 'x.pdf', reason: 'UNREADABLE' }],
    });

    expect(mockUpdateItem).toHaveBeenCalledWith(
      EMPLOYEE_IMPORT_RUN_PK,
      'org-1#run-1',
      expect.objectContaining({
        status: 'COMPLETED_WITH_ERRORS',
        documentsScanned: 10,
        completedAt: expect.any(String),
      }),
    );
    expect(run.status).toBe('COMPLETED_WITH_ERRORS');
    expect(run.failedDocuments).toEqual([{ documentName: 'x.pdf', reason: 'UNREADABLE' }]);
  });
});
