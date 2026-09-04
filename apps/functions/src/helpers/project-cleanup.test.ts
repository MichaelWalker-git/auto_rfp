/**
 * Unit tests for deleteProjectAndRelatedEntities.
 *
 * The important invariant: project deletion must never issue a full-table
 * Scan. The single-table design shares one DynamoDB table across every org,
 * so a Scan scales with total table size, not with the project being deleted,
 * and pushed the delete-project / delete-organization Lambdas past the
 * 30-second API Gateway limit on the Test environment.
 */

jest.mock('./db', () => ({
  batchDeleteItems: jest.fn(),
  deleteAllBySkPrefix: jest.fn(),
  deleteItemWithRetry: jest.fn(),
  getItem: jest.fn(),
  queryAllBySkPrefix: jest.fn(),
  scanByPkWithFilter: jest.fn(),
}));

jest.mock('./s3', () => ({
  deleteS3ObjectsFromKeys: jest.fn(),
  safeS3Key: (key: unknown) => (typeof key === 'string' && key.trim() ? key.trim() : null),
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  batchDeleteItems,
  deleteAllBySkPrefix,
  deleteItemWithRetry,
  getItem,
  queryAllBySkPrefix,
  scanByPkWithFilter,
} from './db';
import { deleteS3ObjectsFromKeys } from './s3';
import { deleteProjectAndRelatedEntities } from './project-cleanup';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { PROJECT_PK } from '../constants/organization';
import { PK_NAME, SK_NAME } from '../constants/common';

const mockGetItem = getItem as jest.MockedFunction<typeof getItem>;
const mockQueryAllBySkPrefix = queryAllBySkPrefix as jest.MockedFunction<typeof queryAllBySkPrefix>;
const mockScan = scanByPkWithFilter as jest.MockedFunction<typeof scanByPkWithFilter>;
const mockBatchDelete = batchDeleteItems as jest.MockedFunction<typeof batchDeleteItems>;
const mockDeleteAllBySkPrefix = deleteAllBySkPrefix as jest.MockedFunction<typeof deleteAllBySkPrefix>;
const mockDeleteItemWithRetry = deleteItemWithRetry as jest.MockedFunction<typeof deleteItemWithRetry>;
const mockDeleteS3 = deleteS3ObjectsFromKeys as jest.MockedFunction<typeof deleteS3ObjectsFromKeys>;

const ORG_ID = 'org-1';
const PROJECT_ID = 'proj-1';

const briefKey = (sk: string) => ({ [PK_NAME]: EXEC_BRIEF_PK, [SK_NAME]: sk });

beforeEach(() => {
  jest.clearAllMocks();

  mockGetItem.mockResolvedValue({
    [PK_NAME]: PROJECT_PK,
    [SK_NAME]: `${ORG_ID}#${PROJECT_ID}`,
    projectId: PROJECT_ID,
  });
  mockQueryAllBySkPrefix.mockResolvedValue([]);
  mockScan.mockResolvedValue([]);
  mockBatchDelete.mockImplementation(async (items) => ({ deleted: items.length, failed: 0 }));
  mockDeleteAllBySkPrefix.mockResolvedValue({ deleted: 0, failed: 0 });
  mockDeleteItemWithRetry.mockResolvedValue(true);
  mockDeleteS3.mockResolvedValue({ deleted: 0, failed: 0, skipped: 0 });
});

describe('deleteProjectAndRelatedEntities', () => {
  it('throws a not-found error when the project does not exist', async () => {
    mockGetItem.mockResolvedValueOnce(null);

    await expect(deleteProjectAndRelatedEntities(ORG_ID, PROJECT_ID)).rejects.toMatchObject({
      name: 'ConditionalCheckFailedException',
    });
    expect(mockDeleteAllBySkPrefix).not.toHaveBeenCalled();
  });

  it('never issues a full-table Scan', async () => {
    await deleteProjectAndRelatedEntities(ORG_ID, PROJECT_ID);

    expect(mockScan).not.toHaveBeenCalled();
  });

  it('finds executive briefs by their projectId sort-key prefix', async () => {
    mockQueryAllBySkPrefix.mockImplementation(async (pk, prefix) => {
      if (pk === EXEC_BRIEF_PK && prefix === `${PROJECT_ID}#`) {
        return [briefKey(`${PROJECT_ID}#opp-1`), briefKey(`${PROJECT_ID}#opp-2`)];
      }
      return [];
    });

    const result = await deleteProjectAndRelatedEntities(ORG_ID, PROJECT_ID);

    expect(mockQueryAllBySkPrefix).toHaveBeenCalledWith(EXEC_BRIEF_PK, `${PROJECT_ID}#`);
    expect(mockBatchDelete).toHaveBeenCalledWith(
      expect.arrayContaining([
        { pk: EXEC_BRIEF_PK, sk: `${PROJECT_ID}#opp-1` },
        { pk: EXEC_BRIEF_PK, sk: `${PROJECT_ID}#opp-2` },
      ]),
    );
    expect(result.executiveBriefs).toEqual({ deleted: 2, failed: 0 });
  });

  it('also deletes legacy briefs referenced by executiveBriefId, without duplicates', async () => {
    mockGetItem.mockResolvedValueOnce({
      [PK_NAME]: PROJECT_PK,
      [SK_NAME]: `${ORG_ID}#${PROJECT_ID}`,
      executiveBriefId: 'legacy-brief-uuid',
    });
    mockQueryAllBySkPrefix.mockImplementation(async (pk, prefix) => {
      if (pk === QUESTION_FILE_PK) {
        return [
          {
            [PK_NAME]: QUESTION_FILE_PK,
            [SK_NAME]: `${PROJECT_ID}#file-1`,
            fileKey: 'docs/file-1.pdf',
            executiveBriefId: `${PROJECT_ID}#opp-1`,
          },
        ];
      }
      if (pk === EXEC_BRIEF_PK && prefix === `${PROJECT_ID}#`) {
        return [briefKey(`${PROJECT_ID}#opp-1`)];
      }
      return [];
    });

    const result = await deleteProjectAndRelatedEntities(ORG_ID, PROJECT_ID);

    const briefDeleteCall = mockBatchDelete.mock.calls.find(([items]) =>
      items.some((i) => i.pk === EXEC_BRIEF_PK),
    );
    expect(briefDeleteCall?.[0]).toHaveLength(2);
    expect(briefDeleteCall?.[0]).toEqual(
      expect.arrayContaining([
        { pk: EXEC_BRIEF_PK, sk: 'legacy-brief-uuid' },
        { pk: EXEC_BRIEF_PK, sk: `${PROJECT_ID}#opp-1` },
      ]),
    );
    expect(result.executiveBriefs).toEqual({ deleted: 2, failed: 0 });
    expect(mockDeleteS3).toHaveBeenCalledWith('test-bucket', ['docs/file-1.pdf']);
  });

  it('deletes the deadline and project records last', async () => {
    const result = await deleteProjectAndRelatedEntities(ORG_ID, PROJECT_ID);

    expect(mockDeleteItemWithRetry).toHaveBeenLastCalledWith(PROJECT_PK, `${ORG_ID}#${PROJECT_ID}`);
    expect(result.project).toBe(true);
    expect(result.deadline).toBe(true);
  });
});
