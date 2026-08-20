// Mock the integration modules before importing the engine.
jest.mock('@/helpers/db', () => ({
  queryBySkPrefix: jest.fn(),
  queryAllBySkPrefix: jest.fn(),
}));
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn(),
}));
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: jest.fn(),
}));
jest.mock('@/helpers/employee');
jest.mock('@/helpers/employee-import');

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { runEmployeeImport, buildMergePatch, normalizeEmployeeName } from './employee-import-engine';
import * as db from '@/helpers/db';
import * as s3 from '@/helpers/s3';
import * as bedrock from '@/helpers/bedrock-http-client';
import * as employeeHelpers from '@/helpers/employee';
import * as importHelpers from '@/helpers/employee-import';
import type { EmployeeImportRunItem, EmployeeItem } from '@auto-rfp/core';

const mockQueryBySkPrefix = db.queryBySkPrefix as jest.MockedFunction<typeof db.queryBySkPrefix>;
const mockQueryAllBySkPrefix = db.queryAllBySkPrefix as jest.MockedFunction<
  typeof db.queryAllBySkPrefix
>;
const mockLoadTextFromS3 = s3.loadTextFromS3 as jest.MockedFunction<typeof s3.loadTextFromS3>;
const mockInvokeModel = bedrock.invokeModel as jest.MockedFunction<typeof bedrock.invokeModel>;
const mockListEmployees = employeeHelpers.listEmployeesByOrg as jest.MockedFunction<
  typeof employeeHelpers.listEmployeesByOrg
>;
const mockCreateEmployee = employeeHelpers.createEmployee as jest.MockedFunction<
  typeof employeeHelpers.createEmployee
>;
const mockUpdateEmployee = employeeHelpers.updateEmployee as jest.MockedFunction<
  typeof employeeHelpers.updateEmployee
>;
const mockDeleteEmployee = employeeHelpers.deleteEmployee as jest.MockedFunction<
  typeof employeeHelpers.deleteEmployee
>;
const mockGetSnapshot = importHelpers.getExtractionSnapshot as jest.MockedFunction<
  typeof importHelpers.getExtractionSnapshot
>;
const mockPutSnapshot = importHelpers.putExtractionSnapshot as jest.MockedFunction<
  typeof importHelpers.putExtractionSnapshot
>;
const mockUpdateProgress = importHelpers.updateImportRunProgress as jest.MockedFunction<
  typeof importHelpers.updateImportRunProgress
>;
const mockCompleteRun = importHelpers.completeImportRun as jest.MockedFunction<
  typeof importHelpers.completeImportRun
>;

const ORG = 'org-1';
const RUN = 'run-1';
const INPUT = { orgId: ORG, importRunId: RUN, triggeredBy: 'user-1' };

/** Bedrock invoke response wrapping the model's JSON payload. */
const bedrockResponse = (payload: unknown): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }] }),
  );

const cvPayload = (overrides: Record<string, unknown> = {}) => ({
  isCv: true,
  name: 'Jane Smith',
  primaryRoles: ['Project Manager'],
  secondaryRoles: [],
  certifications: ['PMP'],
  location: 'ONSHORE',
  ...overrides,
});

/** One org KB + the given DOCUMENT records. */
const setupDocuments = (
  docs: Array<{ id: string; name: string; textFileKey?: string; indexStatus?: string }>,
) => {
  mockQueryBySkPrefix.mockResolvedValue([{ sort_key: `${ORG}#kb-1` }]);
  mockQueryAllBySkPrefix.mockResolvedValue(
    docs.map((d) => ({ ...d, sort_key: `KB#kb-1#DOC#${d.id}` })),
  );
};

const makeEmployee = (overrides: Partial<EmployeeItem> = {}): EmployeeItem => ({
  id: 'emp-1',
  orgId: ORG,
  name: 'Jane Smith',
  primaryRoles: ['Developer'],
  secondaryRoles: [],
  certifications: [],
  source: 'AI_IMPORT',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockListEmployees.mockResolvedValue([]);
  mockLoadTextFromS3.mockResolvedValue('Jane Smith — Project Manager. PMP certified.');
  mockGetSnapshot.mockResolvedValue(null);
  mockPutSnapshot.mockResolvedValue({ employeeId: 'emp-1', orgId: ORG, fields: {} });
  mockUpdateProgress.mockResolvedValue({} as EmployeeImportRunItem);
  // Echo the outcome back so assertions can read the final run state.
  mockCompleteRun.mockImplementation(async (orgId, importRunId, outcome) => ({
    importRunId,
    orgId,
    triggeredBy: 'user-1',
    startedAt: '2026-08-19T10:00:00.000Z',
    completedAt: '2026-08-19T10:05:00.000Z',
    documentsScanned: 0,
    cvsDetected: 0,
    employeesCreated: 0,
    employeesUpdated: 0,
    failedDocuments: [],
    ...outcome,
  }));
});

describe('runEmployeeImport — detection & categorization (BR2.1/BR2.2)', () => {
  it('creates a new employee from a CV and skips non-CVs silently (happy path)', async () => {
    setupDocuments([
      { id: 'doc-1', name: 'jane-cv.pdf', textFileKey: 't/1.txt', indexStatus: 'TEXT_EXTRACTED' },
      { id: 'doc-2', name: 'rfp.pdf', textFileKey: 't/2.txt', indexStatus: 'INDEXED' },
    ]);
    mockInvokeModel
      .mockResolvedValueOnce(bedrockResponse(cvPayload()))
      .mockResolvedValueOnce(bedrockResponse(cvPayload({ isCv: false, name: null })));
    mockCreateEmployee.mockResolvedValue(makeEmployee({ id: 'emp-new' }));

    const run = await runEmployeeImport(INPUT);

    expect(mockCreateEmployee).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, name: 'Jane Smith', resumeRef: 'doc-1' }),
      { source: 'AI_IMPORT', createdBy: 'user-1' },
    );
    expect(mockPutSnapshot).toHaveBeenCalledWith(
      ORG,
      'emp-new',
      expect.objectContaining({ name: 'Jane Smith', resumeRef: 'doc-1' }),
    );
    expect(run.status).toBe('COMPLETED');
    expect(run.documentsScanned).toBe(2);
    expect(run.cvsDetected).toBe(1);
    expect(run.employeesCreated).toBe(1);
    expect(run.failedDocuments).toEqual([]); // non-CV skip is NOT a failure
  });

  it('records UNREADABLE for documents without extracted text', async () => {
    setupDocuments([{ id: 'doc-1', name: 'scan.pdf', indexStatus: 'pending' }]);

    const run = await runEmployeeImport(INPUT);

    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(run.status).toBe('COMPLETED_WITH_ERRORS');
    expect(run.failedDocuments).toEqual([{ documentName: 'scan.pdf', reason: 'UNREADABLE' }]);
  });

  it('records INCOMPLETE_EXTRACTION when a CV yields no person name', async () => {
    setupDocuments([
      { id: 'doc-1', name: 'anon-cv.pdf', textFileKey: 't/1.txt', indexStatus: 'INDEXED' },
    ]);
    mockInvokeModel.mockResolvedValue(bedrockResponse(cvPayload({ name: null })));

    const run = await runEmployeeImport(INPUT);

    expect(mockCreateEmployee).not.toHaveBeenCalled();
    expect(run.cvsDetected).toBe(1);
    expect(run.failedDocuments).toEqual([
      { documentName: 'anon-cv.pdf', reason: 'INCOMPLETE_EXTRACTION' },
    ]);
  });

  it('retries a failed AI call once, then records EXTRACTION_FAILED and continues', async () => {
    setupDocuments([
      { id: 'doc-1', name: 'bad.pdf', textFileKey: 't/1.txt', indexStatus: 'INDEXED' },
      { id: 'doc-2', name: 'good-cv.pdf', textFileKey: 't/2.txt', indexStatus: 'INDEXED' },
    ]);
    mockInvokeModel
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(bedrockResponse(cvPayload()));
    mockCreateEmployee.mockResolvedValue(makeEmployee({ id: 'emp-new' }));

    const run = await runEmployeeImport(INPUT);

    expect(mockInvokeModel).toHaveBeenCalledTimes(3); // 2 attempts for doc-1, 1 for doc-2
    expect(run.status).toBe('COMPLETED_WITH_ERRORS');
    expect(run.failedDocuments).toEqual([{ documentName: 'bad.pdf', reason: 'EXTRACTION_FAILED' }]);
    expect(run.employeesCreated).toBe(1); // the run continued past the failure
  });

  it('aborts the run FAILED after five consecutive EXTRACTION_FAILED documents, preserving imports (BR4.2)', async () => {
    setupDocuments(
      Array.from({ length: 7 }, (_, i) => ({
        id: `doc-${i}`,
        name: `doc-${i}.pdf`,
        textFileKey: `t/${i}.txt`,
        indexStatus: 'INDEXED' as const,
      })),
    );
    mockInvokeModel.mockRejectedValue(new Error('service down'));

    const run = await runEmployeeImport(INPUT);

    expect(run.status).toBe('FAILED');
    expect(run.documentsScanned).toBe(5); // stopped at the fifth consecutive failure
    expect(run.failedDocuments).toHaveLength(5);
    expect(
      run.failedDocuments.every((f) => f.reason === 'EXTRACTION_FAILED'),
    ).toBe(true);
    expect(mockInvokeModel).toHaveBeenCalledTimes(10); // 5 docs x (1 attempt + 1 retry)
  });
});

describe('runEmployeeImport — merge (BR3.1/BR3.2/BR3.3)', () => {
  it('updates the single matching employee (normalized-name match) and refreshes the snapshot', async () => {
    const existing = makeEmployee({ id: 'emp-1', name: '  jane SMITH ' });
    mockListEmployees.mockResolvedValue([existing]);
    setupDocuments([
      { id: 'doc-1', name: 'jane-cv.pdf', textFileKey: 't/1.txt', indexStatus: 'INDEXED' },
    ]);
    mockInvokeModel.mockResolvedValue(bedrockResponse(cvPayload()));
    mockGetSnapshot.mockResolvedValue({
      employeeId: 'emp-1',
      orgId: ORG,
      fields: { primaryRoles: ['Developer'] }, // current === snapshot → AI may overwrite
    });
    mockUpdateEmployee.mockResolvedValue(existing);

    const run = await runEmployeeImport(INPUT);

    expect(mockCreateEmployee).not.toHaveBeenCalled();
    expect(mockUpdateEmployee).toHaveBeenCalledWith(
      ORG,
      'emp-1',
      expect.objectContaining({ primaryRoles: ['Project Manager'] }),
    );
    expect(mockPutSnapshot).toHaveBeenCalledWith(
      ORG,
      'emp-1',
      expect.objectContaining({ primaryRoles: ['Project Manager'] }),
    );
    expect(run.employeesUpdated).toBe(1);
    expect(run.employeesCreated).toBe(0);
  });

  it('records AMBIGUOUS_NAME and writes nothing when several employees match', async () => {
    mockListEmployees.mockResolvedValue([
      makeEmployee({ id: 'emp-1' }),
      makeEmployee({ id: 'emp-2', name: 'JANE SMITH' }),
    ]);
    setupDocuments([
      { id: 'doc-1', name: 'jane-cv.pdf', textFileKey: 't/1.txt', indexStatus: 'INDEXED' },
    ]);
    mockInvokeModel.mockResolvedValue(bedrockResponse(cvPayload()));

    const run = await runEmployeeImport(INPUT);

    expect(mockCreateEmployee).not.toHaveBeenCalled();
    expect(mockUpdateEmployee).not.toHaveBeenCalled();
    expect(mockPutSnapshot).not.toHaveBeenCalled();
    expect(run.failedDocuments).toEqual([
      { documentName: 'jane-cv.pdf', reason: 'AMBIGUOUS_NAME' },
    ]);
  });

  it('never deletes employees — unmatched pool members are left untouched (BR3.2)', async () => {
    mockListEmployees.mockResolvedValue([makeEmployee({ id: 'emp-9', name: 'Bob Jones' })]);
    setupDocuments([
      { id: 'doc-1', name: 'jane-cv.pdf', textFileKey: 't/1.txt', indexStatus: 'INDEXED' },
    ]);
    mockInvokeModel.mockResolvedValue(bedrockResponse(cvPayload()));
    mockCreateEmployee.mockResolvedValue(makeEmployee({ id: 'emp-new' }));

    await runEmployeeImport(INPUT);

    expect(mockDeleteEmployee).not.toHaveBeenCalled();
    expect(mockUpdateEmployee).not.toHaveBeenCalled(); // Bob was not merged into
  });
});

describe('buildMergePatch — field precedence (BR3.3)', () => {
  const extracted = {
    name: 'Jane Smith',
    primaryRoles: ['Project Manager'],
    certifications: ['PMP', 'CSM'],
    resumeRef: 'doc-1',
  };

  it('preserves manually edited fields and overwrites unchanged-since-import fields', () => {
    const current = makeEmployee({
      primaryRoles: ['Developer'], // equals snapshot → AI-owned → overwrite
      certifications: ['AWS SA'], // differs from snapshot → manual edit → preserve
    });
    const snapshot = { primaryRoles: ['Developer'], certifications: ['PMP'] };

    const patch = buildMergePatch(current, extracted, snapshot);

    expect(patch).toHaveProperty('primaryRoles', ['Project Manager']);
    expect(patch).not.toHaveProperty('certifications');
    expect(patch).toHaveProperty('resumeRef', 'doc-1'); // empty current → fill
  });

  it('fills only empty fields when no snapshot exists (manually created employee)', () => {
    const current = makeEmployee({
      primaryRoles: ['Developer'], // non-empty, no snapshot → preserve
      certifications: [], // empty → fill
    });

    const patch = buildMergePatch(current, extracted, null);

    expect(patch).not.toHaveProperty('primaryRoles');
    expect(patch).toHaveProperty('certifications', ['PMP', 'CSM']);
    expect(patch).toHaveProperty('resumeRef', 'doc-1');
  });
});

describe('normalizeEmployeeName (BR3.1)', () => {
  it('trims and case-folds', () => {
    expect(normalizeEmployeeName('  Jane SMITH ')).toBe('jane smith');
    expect(normalizeEmployeeName('jane smith')).toBe(normalizeEmployeeName('JANE SMITH'));
  });
});
