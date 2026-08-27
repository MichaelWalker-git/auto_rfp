jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
  TransientServiceError: class TransientServiceError extends Error {},
}));

const mockFetchBlocks = jest.fn();
const mockMapBlocks = jest.fn();
const mockParsePageRange = jest.fn();
jest.mock('@/helpers/textract-forms', () => ({
  fetchAllAnalysisBlocks: (...args: unknown[]) => mockFetchBlocks(...args),
  mapBlocksToFields: (...args: unknown[]) => mockMapBlocks(...args),
  parsePageRange: (...args: unknown[]) => mockParsePageRange(...args),
}));

const mockFindForm = jest.fn();
const mockUpdateForm = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  findRequiredFormByFormId: (...args: unknown[]) => mockFindForm(...args),
  updateRequiredForm: (...args: unknown[]) => mockUpdateForm(...args),
}));

const mockGetProfile = jest.fn();
jest.mock('@/helpers/company-profile', () => ({
  getCompanyProfile: (...args: unknown[]) => mockGetProfile(...args),
}));

const mockAutofill = jest.fn();
jest.mock('@/helpers/autofill-fields-with-tools', () => ({
  autofillFieldsWithTools: (...args: unknown[]) => mockAutofill(...args),
}));

// WF-B notary scan — mocked so the callback tests stay focused on Textract wiring;
// the scan's own behaviour is covered in notary-wiring.test.ts.
const mockScanFormPageNotary = jest.fn();
jest.mock('@/helpers/notary-wiring', () => ({
  scanFormPageNotary: (...args: unknown[]) => mockScanFormPageNotary(...args),
}));

jest.mock('@/helpers/db', () => ({
  isConditionalCheckFailed: (err: unknown): boolean =>
    typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ConditionalCheckFailedException',
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-test';

import type { Context, SNSEvent } from 'aws-lambda';
import { baseHandler } from './textract-forms-callback';
import type { DetectedFormField } from '@auto-rfp/core';

const ctx = {} as Context;

const event = (msg: Record<string, unknown>): SNSEvent => ({
  Records: [
    {
      Sns: {
        Message: JSON.stringify(msg),
        MessageAttributes: {},
        Subject: '',
        Type: 'Notification',
        UnsubscribeUrl: '',
        SubscribeUrl: '',
        MessageId: 'm-1',
        SignatureVersion: '1',
        Signature: '',
        SigningCertUrl: '',
        Timestamp: '2026-05-20T00:00:00Z',
        TopicArn: 'arn:topic',
      },
      EventSource: 'aws:sns',
      EventVersion: '1.0',
      EventSubscriptionArn: '',
    },
  ],
});

const formStub = {
  formId: 'form-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
};

const field = (overrides: Partial<DetectedFormField>): DetectedFormField => ({
  fieldId: 'fid',
  label: 'Label',
  value: null,
  status: 'EMPTY',
  confidence: null,
  profileFieldKey: null,
  manualReason: null,
  pageNumber: 1,
  cellReference: null,
  boundingBox: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: a clean notary scan. Tests that exercise notary behaviour override this.
  mockScanFormPageNotary.mockResolvedValue({
    notaryStatus: 'NOT_REQUIRED',
    notaryRequirements: [],
    notarySource: 'AI_DETECTED',
  });
});

describe('textract-forms-callback', () => {
  it('skips records with non-JSON SNS messages', async () => {
    const evt: SNSEvent = {
      Records: [
        { Sns: { ...event({}).Records[0].Sns, Message: '{not-json' } } as SNSEvent['Records'][number],
      ],
    };
    await baseHandler(evt, ctx);
    expect(mockFindForm).not.toHaveBeenCalled();
    expect(mockUpdateForm).not.toHaveBeenCalled();
  });

  it('skips records missing JobId/Status/JobTag', async () => {
    await baseHandler(event({ JobId: 'j', Status: 'SUCCEEDED' }), ctx);
    expect(mockFindForm).not.toHaveBeenCalled();
  });

  it('logs and skips when no form matches the JobTag', async () => {
    mockFindForm.mockResolvedValueOnce(null);
    await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);
    expect(mockFindForm).toHaveBeenCalledWith('form-1');
    expect(mockUpdateForm).not.toHaveBeenCalled();
  });

  it('marks the form FAILED when Textract reports a non-success status', async () => {
    mockFindForm.mockResolvedValueOnce(formStub);
    await baseHandler(
      event({ JobId: 'j-1', Status: 'FAILED', JobTag: 'form-1', StatusMessage: 'oops' }),
      ctx,
    );
    expect(mockUpdateForm).toHaveBeenCalledWith({
      ...formStub,
      patch: expect.objectContaining({ status: 'FAILED', errorMessage: expect.stringContaining('oops') }),
    });
    expect(mockFetchBlocks).not.toHaveBeenCalled();
  });

  it('runs the full pipeline and writes READY with stats on success', async () => {
    mockFindForm.mockResolvedValueOnce(formStub);
    mockFetchBlocks.mockResolvedValueOnce([{ Id: 'b1' }]);
    const detected: DetectedFormField[] = [
      field({ fieldId: 'a', label: 'Company Name' }),
      field({ fieldId: 'b', label: 'Signature', status: 'MANUAL_REQUIRED' }),
    ];
    mockMapBlocks.mockReturnValueOnce(detected);
    mockGetProfile.mockResolvedValueOnce({ orgId: 'org-1', companyName: 'Acme Corp' });
    const filled: DetectedFormField[] = [
      { ...detected[0], value: 'Acme Corp', status: 'AUTO_FILLED', confidence: 0.9, profileFieldKey: 'companyName' },
      detected[1],
    ];
    mockAutofill.mockResolvedValueOnce(filled);

    await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

    expect(mockFetchBlocks).toHaveBeenCalledWith('j-1');
    expect(mockAutofill).toHaveBeenCalledWith(detected, { orgId: 'org-1', companyName: 'Acme Corp' });
    expect(mockUpdateForm).toHaveBeenCalledWith({
      ...formStub,
      patch: expect.objectContaining({
        status: 'READY',
        fields: filled,
        totalFieldCount: 2,
        manualFieldCount: 1,
        autoFillPercentage: 50,
      }),
      guardNotaryAiDetected: true,
    });
  });

  it('passes the form\'s sourcePageRange through parsePageRange to mapBlocksToFields', async () => {
    mockFindForm.mockResolvedValueOnce({ ...formStub, sourcePageRange: '17-19' });
    const blocks = [{ Id: 'b1' }];
    mockFetchBlocks.mockResolvedValueOnce(blocks);
    const allowed = new Set([17, 18, 19]);
    mockParsePageRange.mockReturnValueOnce(allowed);
    mockMapBlocks.mockReturnValueOnce([]);

    await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

    expect(mockParsePageRange).toHaveBeenCalledWith('17-19');
    expect(mockMapBlocks).toHaveBeenCalledWith(blocks, allowed);
  });

  it('passes a null page filter through when the form has no sourcePageRange', async () => {
    mockFindForm.mockResolvedValueOnce({ ...formStub, sourcePageRange: null });
    mockFetchBlocks.mockResolvedValueOnce([]);
    mockParsePageRange.mockReturnValueOnce(null);
    mockMapBlocks.mockReturnValueOnce([]);

    await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

    expect(mockParsePageRange).toHaveBeenCalledWith(null);
    expect(mockMapBlocks).toHaveBeenCalledWith([], null);
  });

  it('skips autofill (and writes detected fields verbatim) when no profile exists', async () => {
    mockFindForm.mockResolvedValueOnce(formStub);
    mockFetchBlocks.mockResolvedValueOnce([{ Id: 'b1' }]);
    const detected: DetectedFormField[] = [field({ fieldId: 'a' })];
    mockMapBlocks.mockReturnValueOnce(detected);
    mockGetProfile.mockResolvedValueOnce(null);

    await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

    expect(mockAutofill).not.toHaveBeenCalled();
    expect(mockUpdateForm).toHaveBeenCalledWith({
      ...formStub,
      patch: expect.objectContaining({ status: 'READY', fields: detected }),
      guardNotaryAiDetected: true,
    });
  });

  it('skips autofill when no fields were detected and writes READY with 0 stats', async () => {
    mockFindForm.mockResolvedValueOnce(formStub);
    mockFetchBlocks.mockResolvedValueOnce([]);
    mockMapBlocks.mockReturnValueOnce([]);

    await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

    expect(mockGetProfile).not.toHaveBeenCalled();
    expect(mockAutofill).not.toHaveBeenCalled();
    expect(mockUpdateForm).toHaveBeenCalledWith({
      ...formStub,
      patch: expect.objectContaining({
        status: 'READY',
        totalFieldCount: 0,
        manualFieldCount: 0,
        autoFillPercentage: 0,
      }),
      guardNotaryAiDetected: true,
    });
  });

  it('marks the form FAILED if fetching Textract blocks throws', async () => {
    mockFindForm.mockResolvedValueOnce(formStub);
    mockFetchBlocks.mockRejectedValueOnce(new Error('throttled'));

    await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

    expect(mockUpdateForm).toHaveBeenCalledWith({
      ...formStub,
      patch: expect.objectContaining({ status: 'FAILED', errorMessage: 'throttled' }),
    });
  });

  describe('notary page scan (WF-B)', () => {
    it('folds the notary result into the SAME READY patch (one guarded write), fail-open', async () => {
      mockFindForm.mockResolvedValueOnce(formStub);
      mockFetchBlocks.mockResolvedValueOnce([{ BlockType: 'LINE', Text: 'notary public', Page: 1 }]);
      mockMapBlocks.mockReturnValueOnce([]);
      mockScanFormPageNotary.mockResolvedValueOnce({
        notaryStatus: 'POSSIBLY_REQUIRED',
        notaryRequirements: [
          { documentName: 'form-1', status: 'POSSIBLY_REQUIRED', cue: 'KEYWORD', pageNumber: 1, triggeringText: 'notary public' },
        ],
        notarySource: 'AI_DETECTED',
      });

      await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

      // A POSSIBLY_REQUIRED scan never blocks READY; the notary fields ride the
      // READY patch with the AI_DETECTED guard (one write).
      expect(mockUpdateForm).toHaveBeenCalledTimes(1);
      expect(mockUpdateForm).toHaveBeenCalledWith({
        ...formStub,
        patch: expect.objectContaining({ status: 'READY', notaryStatus: 'POSSIBLY_REQUIRED', notarySource: 'AI_DETECTED' }),
        guardNotaryAiDetected: true,
      });
    });

    it('preserves a USER_SET notary override: reaches READY without the notary fields on a conditional-check rejection', async () => {
      mockFindForm.mockResolvedValueOnce(formStub);
      mockFetchBlocks.mockResolvedValueOnce([{ BlockType: 'LINE', Text: 'notary', Page: 1 }]);
      mockMapBlocks.mockReturnValueOnce([]);
      mockScanFormPageNotary.mockResolvedValueOnce({
        notaryStatus: 'REQUIRED',
        notaryRequirements: [{ documentName: 'form-1', status: 'REQUIRED', cue: 'ACK_BLOCK', pageNumber: 1, triggeringText: 'must be notarized' }],
        notarySource: 'AI_DETECTED',
      });
      // First (guarded) write rejects — a USER_SET override exists; second write succeeds.
      mockUpdateForm
        .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })
        .mockResolvedValueOnce({});

      await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

      expect(mockUpdateForm).toHaveBeenCalledTimes(2);
      // Fallback write reaches READY but does NOT touch the notary fields.
      const secondCall = mockUpdateForm.mock.calls[1][0];
      expect(secondCall.patch.status).toBe('READY');
      expect(secondCall.patch).not.toHaveProperty('notaryStatus');
      expect(secondCall.guardNotaryAiDetected).toBeUndefined();
    });

    it('scopes the notary scan to the form\'s OWN pages (sourcePageRange) — never the whole shared PDF', async () => {
      // Two form records share one source PDF / Textract job; this form owns pages 3-4.
      // Without the filter, a notary clause anywhere in the PDF would flag every form.
      mockFindForm.mockResolvedValueOnce({ ...formStub, sourcePageRange: '3-4' });
      const allBlocks = [
        { BlockType: 'LINE', Text: 'all bids must be notarized', Page: 1 },
        { BlockType: 'LINE', Text: 'company name', Page: 3 },
        { BlockType: 'LINE', Text: 'signature', Page: 4 },
        { BlockType: 'LINE', Text: 'state of county of', Page: 5 },
      ];
      mockFetchBlocks.mockResolvedValueOnce(allBlocks);
      mockParsePageRange.mockReturnValueOnce(new Set([3, 4]));
      mockMapBlocks.mockReturnValueOnce([]);

      await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

      expect(mockScanFormPageNotary).toHaveBeenCalledTimes(1);
      const { blocks } = mockScanFormPageNotary.mock.calls[0][0] as { blocks: Array<{ Page?: number }> };
      expect(blocks.map((b) => b.Page)).toEqual([3, 4]);
    });

    it('scans ALL pages when the form has no sourcePageRange (whole-file form)', async () => {
      mockFindForm.mockResolvedValueOnce(formStub);
      const allBlocks = [
        { BlockType: 'LINE', Text: 'notary public', Page: 1 },
        { BlockType: 'LINE', Text: 'signature', Page: 2 },
      ];
      mockFetchBlocks.mockResolvedValueOnce(allBlocks);
      mockParsePageRange.mockReturnValueOnce(null);
      mockMapBlocks.mockReturnValueOnce([]);

      await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

      const { blocks } = mockScanFormPageNotary.mock.calls[0][0] as { blocks: unknown[] };
      expect(blocks).toEqual(allBlocks);
    });

    it('rethrows a genuine (non-conditional) write error so the form is marked FAILED', async () => {
      mockFindForm.mockResolvedValueOnce(formStub);
      mockFetchBlocks.mockResolvedValueOnce([{ BlockType: 'LINE', Text: 'notary', Page: 1 }]);
      mockMapBlocks.mockReturnValueOnce([]);
      // Guarded READY write throws a real service error, then the catch writes FAILED.
      mockUpdateForm
        .mockRejectedValueOnce(new Error('ddb unavailable'))
        .mockResolvedValueOnce({});

      await baseHandler(event({ JobId: 'j-1', Status: 'SUCCEEDED', JobTag: 'form-1' }), ctx);

      expect(mockUpdateForm).toHaveBeenLastCalledWith(expect.objectContaining({
        patch: expect.objectContaining({ status: 'FAILED', errorMessage: 'ddb unavailable' }),
      }));
    });
  });
});
