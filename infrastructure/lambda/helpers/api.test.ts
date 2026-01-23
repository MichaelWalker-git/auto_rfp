// Mock sentry before importing modules
jest.mock('../sentry-lambda', () => ({
  withSentryLambda: (handler: any) => handler,
}));

import { apiResponse, getOrgId } from './api';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

describe('apiResponse', () => {
  it('should return correct structure with 200 status', () => {
    const result = apiResponse(200, { message: 'Success' }) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    expect(result.body).toBe(JSON.stringify({ message: 'Success' }));
  });

  it('should handle 400 error response', () => {
    const result = apiResponse(400, { error: 'Bad request' }) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string)).toEqual({ error: 'Bad request' });
  });

  it('should handle 500 error response', () => {
    const result = apiResponse(500, { error: 'Internal server error' }) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
  });

  it('should serialize complex objects', () => {
    const complexBody = {
      data: {
        items: [{ id: 1, name: 'test' }],
        pagination: { page: 1, total: 100 },
      },
    };
    const result = apiResponse(200, complexBody) as APIGatewayProxyStructuredResultV2;

    expect(JSON.parse(result.body as string)).toEqual(complexBody);
  });

  it('should serialize arrays', () => {
    const arrayBody = [{ id: 1 }, { id: 2 }];
    const result = apiResponse(200, arrayBody) as APIGatewayProxyStructuredResultV2;

    expect(JSON.parse(result.body as string)).toEqual(arrayBody);
  });

  it('should handle null body', () => {
    const result = apiResponse(204, null) as APIGatewayProxyStructuredResultV2;

    expect(result.body).toBe('null');
  });

  it('should handle string body', () => {
    const result = apiResponse(200, 'plain string') as APIGatewayProxyStructuredResultV2;

    expect(result.body).toBe('"plain string"');
  });
});

describe('getOrgId', () => {
  const createMockEvent = (
    overrides: Partial<APIGatewayProxyEventV2> = {}
  ): APIGatewayProxyEventV2 => ({
    version: '2.0',
    routeKey: 'GET /test',
    rawPath: '/test',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789',
      apiId: 'api-id',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: '/test',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'request-id',
      routeKey: 'GET /test',
      stage: 'prod',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
    ...overrides,
  });

  it('should extract orgId from JWT claims (custom:orgId)', () => {
    const event = createMockEvent({
      requestContext: {
        ...createMockEvent().requestContext,
        authorizer: {
          jwt: {
            claims: {
              'custom:orgId': 'org-123-from-jwt',
              sub: 'user-456',
            },
          },
        },
      },
    } as unknown as Partial<APIGatewayProxyEventV2>);

    const result = getOrgId(event);
    expect(result).toBe('org-123-from-jwt');
  });

  it('should extract orgId from direct authorizer claims', () => {
    const event = createMockEvent({
      requestContext: {
        ...createMockEvent().requestContext,
        authorizer: {
          claims: {
            'custom:orgId': 'org-456-direct',
          },
        },
      },
    } as unknown as Partial<APIGatewayProxyEventV2>);

    const result = getOrgId(event);
    expect(result).toBe('org-456-direct');
  });

  it('should fallback to query string parameter when no JWT claim', () => {
    const event = createMockEvent({
      queryStringParameters: {
        orgId: 'org-789-query',
      },
    });

    const result = getOrgId(event);
    expect(result).toBe('org-789-query');
  });

  it('should prefer JWT claim over query string', () => {
    const event = createMockEvent({
      requestContext: {
        ...createMockEvent().requestContext,
        authorizer: {
          jwt: {
            claims: {
              'custom:orgId': 'org-from-jwt',
            },
          },
        },
      },
      queryStringParameters: {
        orgId: 'org-from-query',
      },
    } as unknown as Partial<APIGatewayProxyEventV2>);

    const result = getOrgId(event);
    expect(result).toBe('org-from-jwt');
  });

  it('should return undefined when no orgId found anywhere', () => {
    const event = createMockEvent();

    const result = getOrgId(event);
    expect(result).toBeUndefined();
  });

  it('should return undefined when queryStringParameters is null', () => {
    const event = createMockEvent({
      queryStringParameters: undefined,
    });

    const result = getOrgId(event);
    expect(result).toBeUndefined();
  });

  it('should handle empty authorizer object', () => {
    const event = createMockEvent({
      requestContext: {
        ...createMockEvent().requestContext,
        authorizer: {},
      },
      queryStringParameters: {
        orgId: 'fallback-org',
      },
    } as unknown as Partial<APIGatewayProxyEventV2>);

    const result = getOrgId(event);
    expect(result).toBe('fallback-org');
  });
});
