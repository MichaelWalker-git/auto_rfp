import type { DynamoDBRecord } from 'aws-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';

const mockQueryByIndex = jest.fn();
jest.mock('@/helpers/db', () => ({
  queryByIndex: (...args: unknown[]) => mockQueryByIndex(...args),
}));

const mockGetOrganizationById = jest.fn();
jest.mock('@/helpers/org', () => ({
  getOrganizationById: (...args: unknown[]) => mockGetOrganizationById(...args),
}));

const mockWithScope = jest.fn();
const mockCaptureMessage = jest.fn();
jest.mock('@/sentry-lambda', () => ({
  Sentry: {
    withScope: (cb: (scope: unknown) => void) => {
      mockWithScope(cb);
      cb({
        setLevel: jest.fn(),
        setTag: jest.fn(),
        setContext: jest.fn(),
      });
    },
    captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  },
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  classifyMembership,
  detectNewMember,
  emitDetectionAlert,
} from './member-detection';

const USER_PK = 'USER';
const PK_NAME = 'partition_key';

const makeInsert = (item: Record<string, unknown>): DynamoDBRecord => ({
  eventName: 'INSERT',
  dynamodb: { NewImage: marshall(item, { removeUndefinedValues: true }) },
} as unknown as DynamoDBRecord);

const userItem = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  [PK_NAME]: USER_PK,
  userId: 'user-1',
  orgId: 'org-1',
  email: 'jane@example.com',
  firstName: 'Jane',
  role: 'ADMIN',
  createdAt: '2026-06-08T12:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryByIndex.mockReset();
  mockGetOrganizationById.mockReset();
  mockWithScope.mockReset();
  mockCaptureMessage.mockReset();
});

describe('classifyMembership', () => {
  it('returns NEW_ACCOUNT when only one membership exists', async () => {
    mockQueryByIndex.mockResolvedValueOnce([{ orgId: 'org-1' }]);
    expect(await classifyMembership('user-1')).toBe('NEW_ACCOUNT');
  });

  it('returns ADDED_TO_ORG when more than one membership exists', async () => {
    mockQueryByIndex.mockResolvedValueOnce([{ orgId: 'org-1' }, { orgId: 'org-2' }]);
    expect(await classifyMembership('user-1')).toBe('ADDED_TO_ORG');
  });

  it('queries the byUserId GSI scoped to USER items', async () => {
    mockQueryByIndex.mockResolvedValueOnce([{ orgId: 'org-1' }]);
    await classifyMembership('user-1');
    expect(mockQueryByIndex).toHaveBeenCalledWith(
      'byUserId',
      'userId',
      'user-1',
      { name: PK_NAME, value: USER_PK },
    );
  });
});

describe('detectNewMember — org gating', () => {
  it('does not alert when the org has not opted in', async () => {
    mockGetOrganizationById.mockResolvedValueOnce({ id: 'org-1', name: 'VRC', enableMemberDetection: false });
    await detectNewMember(makeInsert(userItem()));
    expect(mockQueryByIndex).not.toHaveBeenCalled();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('does not alert when the org is missing', async () => {
    mockGetOrganizationById.mockResolvedValueOnce(null);
    await detectNewMember(makeInsert(userItem()));
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

describe('detectNewMember — classification + alerting', () => {
  it('emits a NEW_ACCOUNT alert for a first membership in an enabled org', async () => {
    mockGetOrganizationById.mockResolvedValueOnce({ id: 'org-1', name: 'VRC', enableMemberDetection: true });
    mockQueryByIndex.mockResolvedValueOnce([{ orgId: 'org-1' }]);

    await detectNewMember(makeInsert(userItem()));

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [message, level] = mockCaptureMessage.mock.calls[0];
    expect(message).toContain('New AutoRFP account');
    expect(message).toContain('jane@example.com');
    expect(level).toBe('info');
  });

  it('emits an ADDED_TO_ORG alert when the account already exists elsewhere', async () => {
    mockGetOrganizationById.mockResolvedValueOnce({ id: 'org-1', name: 'VRC', enableMemberDetection: true });
    mockQueryByIndex.mockResolvedValueOnce([{ orgId: 'org-1' }, { orgId: 'org-2' }]);

    await detectNewMember(makeInsert(userItem()));

    const [message] = mockCaptureMessage.mock.calls[0];
    expect(message).toContain('Account added to organization');
  });
});

describe('detectNewMember — record filtering', () => {
  it('ignores records without a NewImage', async () => {
    await detectNewMember({ eventName: 'INSERT', dynamodb: {} } as DynamoDBRecord);
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
  });

  it('ignores non-USER items', async () => {
    await detectNewMember(makeInsert({ [PK_NAME]: 'PROJECT', userId: 'u-1', orgId: 'o-1' }));
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
  });

  it('ignores USER items missing userId or orgId', async () => {
    await detectNewMember(makeInsert({ [PK_NAME]: USER_PK, email: 'x@y.com' }));
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
  });
});

describe('detectNewMember — resilience', () => {
  it('swallows errors and never throws', async () => {
    mockGetOrganizationById.mockRejectedValueOnce(new Error('dynamo down'));
    await expect(detectNewMember(makeInsert(userItem()))).resolves.toBeUndefined();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('skips the alert when the parsed payload is malformed (bad email)', async () => {
    mockGetOrganizationById.mockResolvedValueOnce({ id: 'org-1', name: 'VRC', enableMemberDetection: true });
    mockQueryByIndex.mockResolvedValueOnce([{ orgId: 'org-1' }]);

    await detectNewMember(makeInsert(userItem({ email: 'not-an-email' })));

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

describe('emitDetectionAlert', () => {
  it('sets the member_detection tags and captures the message at info level', () => {
    emitDetectionAlert({
      eventType: 'NEW_ACCOUNT',
      timestamp: '2026-06-08T12:00:00.000Z',
      orgId: 'org-1',
      orgName: 'VRC',
      email: 'jane@example.com',
      firstName: 'Jane',
      role: 'ADMIN',
      userId: 'user-1',
    });
    expect(mockWithScope).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
  });
});
