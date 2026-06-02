// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
}));

// Mock template helpers — the handler's branching logic is under test, not DynamoDB
const mockGetTemplate = jest.fn();
const mockSetDefaultTemplate = jest.fn();
const mockClearDefaultForCategory = jest.fn();
jest.mock('@/helpers/template', () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
  setDefaultTemplate: (...args: unknown[]) => mockSetDefaultTemplate(...args),
  clearDefaultForCategory: (...args: unknown[]) => mockClearDefaultForCategory(...args),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({})),
  setAuditContext: jest.fn(),
}));

import { baseHandler } from './set-default-template';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { TemplateItem } from '@auto-rfp/core';

const publishedTemplate = (overrides: Partial<TemplateItem> = {}): TemplateItem => ({
  id: 'tpl-1',
  orgId: 'org-1',
  name: 'Template',
  category: 'TECHNICAL_PROPOSAL',
  tags: [],
  isDefault: false,
  status: 'PUBLISHED',
  currentVersion: 1,
  versions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: '00000000-0000-0000-0000-000000000000',
  isArchived: false,
  usageCount: 0,
  usedInProjectIds: [],
  ...overrides,
});

const makeEvent = (
  action: string | undefined,
  { id = 'tpl-1', orgId = 'org-1' }: { id?: string; orgId?: string } = {},
): APIGatewayProxyEventV2 =>
  ({
    pathParameters: { id },
    queryStringParameters: { orgId, ...(action ? { action } : {}) },
  } as unknown as APIGatewayProxyEventV2);

const parseBody = (res: unknown) => JSON.parse((res as { body: string }).body);

describe('set-default-template handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('400 when template id is missing', async () => {
    const res = await baseHandler({ pathParameters: {}, queryStringParameters: { orgId: 'org-1' } } as unknown as APIGatewayProxyEventV2);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('400 when orgId is missing', async () => {
    const res = await baseHandler({ pathParameters: { id: 'tpl-1' }, queryStringParameters: {} } as unknown as APIGatewayProxyEventV2);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('404 when template not found', async () => {
    mockGetTemplate.mockResolvedValue(null);
    const res = await baseHandler(makeEvent('set'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('sets the default marker on a published template', async () => {
    mockGetTemplate.mockResolvedValue(publishedTemplate());
    mockSetDefaultTemplate.mockResolvedValue(undefined);

    const res = await baseHandler(makeEvent('set'));

    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(mockSetDefaultTemplate).toHaveBeenCalledWith('org-1', 'tpl-1', 'TECHNICAL_PROPOSAL');
    expect(parseBody(res).isDefault).toBe(true);
  });

  it('defaults to the set action when no action query param is given', async () => {
    mockGetTemplate.mockResolvedValue(publishedTemplate());
    const res = await baseHandler(makeEvent(undefined));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(mockSetDefaultTemplate).toHaveBeenCalled();
  });

  it('409 when trying to set a DRAFT template as default', async () => {
    mockGetTemplate.mockResolvedValue(publishedTemplate({ status: 'DRAFT' }));
    const res = await baseHandler(makeEvent('set'));
    expect((res as { statusCode: number }).statusCode).toBe(409);
    expect(mockSetDefaultTemplate).not.toHaveBeenCalled();
  });

  it('410 when trying to set an archived template as default', async () => {
    mockGetTemplate.mockResolvedValue(publishedTemplate({ isArchived: true }));
    const res = await baseHandler(makeEvent('set'));
    expect((res as { statusCode: number }).statusCode).toBe(410);
    expect(mockSetDefaultTemplate).not.toHaveBeenCalled();
  });

  it('unsets the default marker via the unset action', async () => {
    mockGetTemplate.mockResolvedValue(publishedTemplate({ isDefault: true }));
    mockClearDefaultForCategory.mockResolvedValue(['tpl-1']);

    const res = await baseHandler(makeEvent('unset'));

    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(mockClearDefaultForCategory).toHaveBeenCalledWith('org-1', 'TECHNICAL_PROPOSAL', undefined);
    expect(parseBody(res).isDefault).toBe(false);
    expect(mockSetDefaultTemplate).not.toHaveBeenCalled();
  });
});
