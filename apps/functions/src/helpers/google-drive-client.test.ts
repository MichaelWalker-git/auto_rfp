/**
 * google-drive-client.test.ts
 *
 * Covers the consolidated auth bootstrap. Every branch here previously existed in
 * three hand-copied versions, so the point is that "Drive is unusable for this
 * org" resolves to `null` rather than throwing — the poller depends on being able
 * to skip an unconfigured org without aborting its pass.
 */

const mockAuthorize = jest.fn();
const mockJWT = jest.fn();
const mockDrive = jest.fn(() => ({ files: {} }));

jest.mock('googleapis', () => ({
  google: {
    auth: {
      JWT: jest.fn((opts: unknown) => {
        mockJWT(opts);
        return { authorize: mockAuthorize };
      }),
    },
    drive: (...args: unknown[]) => mockDrive(...(args as [])),
  },
}));

const mockGetApiKey = jest.fn();
jest.mock('./api-key-storage', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

import {
  getDriveClientForOrg,
  isDriveForbidden,
  isDriveNotFound,
  isDriveRateLimited,
} from './google-drive-client';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

const validCredentials = {
  client_email: 'svc@project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  client_id: '123456789',
  delegate_email: 'owner@example.com',
};

describe('getDriveClientForOrg', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthorize.mockResolvedValue(undefined);
  });

  it('returns null when no secret is configured for the org', async () => {
    mockGetApiKey.mockResolvedValue(undefined);

    expect(await getDriveClientForOrg(ORG_ID)).toBeNull();
    expect(mockJWT).not.toHaveBeenCalled();
  });

  it('returns null when the stored credential is not valid JSON', async () => {
    // A plain API key pasted where a service-account JSON belongs.
    mockGetApiKey.mockResolvedValue('AIzaSyNotJson');

    expect(await getDriveClientForOrg(ORG_ID)).toBeNull();
    expect(mockJWT).not.toHaveBeenCalled();
  });

  it('returns null when client_email or private_key is missing', async () => {
    mockGetApiKey.mockResolvedValue(
      JSON.stringify({ ...validCredentials, private_key: undefined }),
    );

    expect(await getDriveClientForOrg(ORG_ID)).toBeNull();
    expect(mockJWT).not.toHaveBeenCalled();
  });

  it('returns null when no delegate email is available', async () => {
    // Service accounts have no Drive storage quota, so there is nothing useful to
    // do without an impersonation subject.
    mockGetApiKey.mockResolvedValue(
      JSON.stringify({ ...validCredentials, delegate_email: undefined }),
    );

    expect(await getDriveClientForOrg(ORG_ID)).toBeNull();
    expect(mockJWT).not.toHaveBeenCalled();
  });

  it('uses the fallback resolver when delegate_email is absent', async () => {
    mockGetApiKey.mockResolvedValue(
      JSON.stringify({ ...validCredentials, delegate_email: undefined }),
    );
    const resolveDelegateFallback = jest.fn().mockResolvedValue('member@example.com');

    const client = await getDriveClientForOrg(ORG_ID, { resolveDelegateFallback });

    expect(resolveDelegateFallback).toHaveBeenCalledTimes(1);
    expect(client?.delegateEmail).toBe('member@example.com');
    expect(mockJWT).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'member@example.com' }),
    );
  });

  it('prefers delegate_email over the fallback resolver', async () => {
    mockGetApiKey.mockResolvedValue(JSON.stringify(validCredentials));
    const resolveDelegateFallback = jest.fn().mockResolvedValue('member@example.com');

    const client = await getDriveClientForOrg(ORG_ID, { resolveDelegateFallback });

    expect(resolveDelegateFallback).not.toHaveBeenCalled();
    expect(client?.delegateEmail).toBe('owner@example.com');
  });

  it('returns null when the fallback resolver itself throws', async () => {
    mockGetApiKey.mockResolvedValue(
      JSON.stringify({ ...validCredentials, delegate_email: undefined }),
    );
    const resolveDelegateFallback = jest.fn().mockRejectedValue(new Error('DynamoDB down'));

    expect(await getDriveClientForOrg(ORG_ID, { resolveDelegateFallback })).toBeNull();
  });

  it('builds a JWT with the delegate as subject and the full drive scope', async () => {
    mockGetApiKey.mockResolvedValue(JSON.stringify(validCredentials));

    const client = await getDriveClientForOrg(ORG_ID);

    expect(client).not.toBeNull();
    expect(mockJWT).toHaveBeenCalledWith({
      email: validCredentials.client_email,
      key: validCredentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
      subject: 'owner@example.com',
    });
    expect(mockDrive).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v3' }),
    );
  });

  it('returns null when authorize() rejects (delegation not configured)', async () => {
    mockGetApiKey.mockResolvedValue(JSON.stringify(validCredentials));
    mockAuthorize.mockRejectedValue(new Error('unauthorized_client'));

    expect(await getDriveClientForOrg(ORG_ID)).toBeNull();
  });
});

describe('Drive error classification', () => {
  it('recognises 404 from numeric code, string code, and response.status', () => {
    expect(isDriveNotFound({ code: 404 })).toBe(true);
    expect(isDriveNotFound({ code: '404' })).toBe(true);
    expect(isDriveNotFound({ response: { status: 404 } })).toBe(true);
    expect(isDriveNotFound({ code: 403 })).toBe(false);
    expect(isDriveNotFound(new Error('boom'))).toBe(false);
    expect(isDriveNotFound(null)).toBe(false);
  });

  it('treats 401 and 403 as forbidden — the never-recreate cases', () => {
    expect(isDriveForbidden({ code: 401 })).toBe(true);
    expect(isDriveForbidden({ code: 403 })).toBe(true);
    expect(isDriveForbidden({ code: 404 })).toBe(false);
  });

  it('treats 429 and 5xx as retryable', () => {
    expect(isDriveRateLimited({ code: 429 })).toBe(true);
    expect(isDriveRateLimited({ code: 500 })).toBe(true);
    expect(isDriveRateLimited({ code: 503 })).toBe(true);
    expect(isDriveRateLimited({ code: 404 })).toBe(false);
  });
});
