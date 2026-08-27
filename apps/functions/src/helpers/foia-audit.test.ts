process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

const mockWriteAuditLog = jest.fn();
jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: (...a: unknown[]) => mockWriteAuditLog(...a),
}));

const mockGetHmacSecret = jest.fn();
jest.mock('@/helpers/secret', () => ({
  getHmacSecret: (...a: unknown[]) => mockGetHmacSecret(...a),
}));

import { writeFoiaSendAuditLog } from './foia-audit';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHmacSecret.mockResolvedValue('test-secret');
  mockWriteAuditLog.mockResolvedValue({});
});

describe('writeFoiaSendAuditLog', () => {
  const base = { orgId: 'org-1', foiaId: 'foia-1', sentBy: 'system' as const };

  it('writes a FOIA_REQUEST_SENT entry against the request id', async () => {
    await writeFoiaSendAuditLog({ ...base, result: 'success' });

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FOIA_REQUEST_SENT',
        resource: 'foia_request',
        resourceId: 'foia-1',
        organizationId: 'org-1',
        result: 'success',
      }),
      'test-secret',
    );
  });

  /**
   * The distinction an auditor needs most: whether a human authorised this specific
   * filing, or a cron did.
   */
  it('marks an unattended send as system-originated', async () => {
    await writeFoiaSendAuditLog({ ...base, result: 'success' });

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'system', userName: 'system (unattended)' }),
      expect.anything(),
    );
  });

  it('records the approving user when a human sent it', async () => {
    await writeFoiaSendAuditLog({ ...base, sentBy: 'user-42', result: 'success' });

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-42', userName: 'user-42' }),
      expect.anything(),
    );
  });

  it('carries the failure reason on a failed send', async () => {
    await writeFoiaSendAuditLog({
      ...base,
      result: 'failure',
      errorMessage: 'SES rejected the message',
    });

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failure', errorMessage: 'SES rejected the message' }),
      expect.anything(),
    );
  });

  it('stores send detail under changes.after', async () => {
    await writeFoiaSendAuditLog({
      ...base,
      result: 'success',
      detail: { recipient: 'foia@army.mil', sesMessageId: 'ses-1' },
    });

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { after: { recipient: 'foia@army.mil', sesMessageId: 'ses-1' } },
      }),
      expect.anything(),
    );
  });

  /**
   * Load-bearing: the caller has already transmitted a legal document to a government
   * agency and moved the record to SENT. Throwing here would turn a delivered filing into
   * an error and could drive a retry — a worse outcome than a missing log line.
   */
  it('never throws when the audit write fails', async () => {
    mockWriteAuditLog.mockRejectedValue(new Error('dynamo down'));

    await expect(writeFoiaSendAuditLog({ ...base, result: 'success' })).resolves.toBeUndefined();
  });

  it('never throws when the HMAC secret cannot be read', async () => {
    // The exact failure the missing ssm:GetParameter grant produced: AccessDenied,
    // swallowed, leaving no audit entry and no visible error.
    mockGetHmacSecret.mockRejectedValue(new Error('AccessDeniedException'));

    await expect(writeFoiaSendAuditLog({ ...base, result: 'success' })).resolves.toBeUndefined();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });
});
