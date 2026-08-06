jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (fn: unknown) => fn }));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockGetForm = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  getRequiredForm: (...args: unknown[]) => mockGetForm(...args),
}));

const mockGetFileBufferFromS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  getFileBufferFromS3: (...args: unknown[]) => mockGetFileBufferFromS3(...args),
}));

const mockConvertToHtml = jest.fn();
jest.mock('mammoth', () => ({
  __esModule: true,
  default: { convertToHtml: (...args: unknown[]) => mockConvertToHtml(...args) },
}));

// JSZip: minimal stub — file(name) returns an object with async() reading a
// stored map; file(name, content) writes it; generateAsync returns a buffer.
const zipStore: Record<string, string> = {};
jest.mock('jszip', () => ({
  __esModule: true,
  default: {
    loadAsync: jest.fn(async () => ({
      file: (name: string, content?: string) => {
        if (content !== undefined) { zipStore[name] = content; return undefined; }
        return zipStore[name] !== undefined ? { async: async () => zipStore[name] } : null;
      },
      generateAsync: async () => Buffer.from('marked-docx'),
    })),
  },
}));

const mockInject = jest.fn();
jest.mock('@/helpers/docx-fill-spots', () => ({
  injectFieldMarkers: (...args: unknown[]) => mockInject(...args),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (event: { queryStringParameters?: Record<string, string> }) => event.queryStringParameters?.orgId,
}));

process.env.DOCUMENTS_BUCKET = 'docs-bucket';

import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { baseHandler } from './render-docx-form';

const queryEvent = (q: Record<string, string>): AuthedEvent =>
  ({ queryStringParameters: q } as unknown as AuthedEvent);

const baseForm = (overrides: Record<string, unknown> = {}) => ({
  formId: 'form-1', orgId: 'org', projectId: 'p', opportunityId: 'o',
  sourceFileKey: 'org/p/o/required-forms/form-1/source.docx',
  sourceFileName: 'source.docx',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(zipStore)) delete zipStore[k];
  zipStore['word/document.xml'] = '<w:document/>';
  mockInject.mockReturnValue({ xml: '<w:document marked/>', spots: [] });
});

describe('render-docx-form', () => {
  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(queryEvent({ projectId: 'p', opportunityId: 'o', formId: 'f' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the form is missing', async () => {
    mockGetForm.mockResolvedValueOnce(null);
    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'f' }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for a non-Word source file', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm({ sourceFileKey: 'org/p/o/source.pdf' }));
    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));
    expect(res.statusCode).toBe(400);
    expect(mockConvertToHtml).not.toHaveBeenCalled();
  });

  it('returns 400 for a legacy .doc (not renderable — mammoth/JSZip need OOXML)', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm({ sourceFileKey: 'org/p/o/source.doc', sourceFileName: 'source.doc' }));
    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));
    expect(res.statusCode).toBe(400);
    expect(mockConvertToHtml).not.toHaveBeenCalled();
  });

  it('degrades gracefully (200, html: null) when the docx is unreadable instead of 500', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm());
    mockGetFileBufferFromS3.mockResolvedValueOnce(Buffer.from('not a real zip'));
    mockInject.mockReturnValueOnce({ xml: '<w:document marked/>', spots: [] });
    // Simulate JSZip/mammoth choking on a malformed file.
    mockConvertToHtml.mockRejectedValueOnce(new Error('End of data reached (data length = …)'));

    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ html: null, fileName: 'source.docx', spots: [] });
  });

  it('injects field markers, converts the marked DOCX to HTML, and returns html + spots', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm());
    mockGetFileBufferFromS3.mockResolvedValueOnce(Buffer.from('docx bytes'));
    const spots = [{ kind: 'TABLE_CELL_LABEL', ref: 'Title:', occurrence: 0, label: 'FIRM — Title:' }];
    mockInject.mockReturnValueOnce({ xml: '<w:document marked/>', spots });
    mockConvertToHtml.mockResolvedValueOnce({ value: '<p>Hello</p>', messages: [] });

    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));

    expect(res.statusCode).toBe(200);
    expect(mockGetFileBufferFromS3).toHaveBeenCalledWith('docs-bucket', 'org/p/o/required-forms/form-1/source.docx');
    // Markers were injected before conversion (mammoth sees the marked buffer).
    expect(mockInject).toHaveBeenCalledWith('<w:document/>');
    expect(JSON.parse(res.body as string)).toEqual({ html: '<p>Hello</p>', fileName: 'source.docx', spots });
  });
});
