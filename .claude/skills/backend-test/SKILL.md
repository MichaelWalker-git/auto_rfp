---
name: backend-test
description: Create Jest tests for Lambda handlers with proper AWS SDK mocking, middy mocking, and comprehensive test coverage
---

# Backend Test Creation

When creating tests for Lambda handlers or helpers, follow these exact steps:

## 1. File Location

Create `apps/functions/src/handlers/<domain>/<handler>.test.ts` (co-located with source).

## 2. Test Template

```typescript
// --- Mocks MUST come before imports ---

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params: unknown) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params: unknown) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params: unknown) => ({ type: 'Query', params })),
  DeleteCommand: jest.fn((params: unknown) => ({ type: 'Delete', params })),
  UpdateCommand: jest.fn((params: unknown) => ({ type: 'Update', params })),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234'),
}));

// Mock Sentry
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

// Mock audit middleware
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// --- Now import the handler ---
import { <handlerName> } from './<handler>';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// --- Test helpers ---
const buildEvent = (overrides: Partial<AuthedEvent> = {}): AuthedEvent => ({
  body: null,
  headers: {},
  queryStringParameters: null,
  pathParameters: null,
  requestContext: {
    http: { sourceIp: '127.0.0.1', userAgent: 'test' },
  } as AuthedEvent['requestContext'],
  auth: {
    userId: 'user-123',
    userName: 'Test User',
    orgId: 'org-123',
    claims: {},
  },
  ...overrides,
} as AuthedEvent);

const parseBody = (result: { body?: string }) =>
  JSON.parse(result.body ?? '{}');

// --- Tests ---
describe('<handlerName>', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  // 1. Happy path
  it('should return 200 on valid input', async () => {
    mockSend.mockResolvedValueOnce({ /* mock DB response */ });

    const event = buildEvent({
      body: JSON.stringify({ orgId: 'org-123', /* ... */ }),
    });

    const result = await <handlerName>(event);
    const body = parseBody(result as { body: string });

    expect(result).toHaveProperty('statusCode', 200);
    expect(body.ok).toBe(true);
  });

  // 2. Validation error
  it('should return 400 on invalid input', async () => {
    const event = buildEvent({ body: JSON.stringify({}) });

    const result = await <handlerName>(event);
    const body = parseBody(result as { body: string });

    expect(result).toHaveProperty('statusCode', 400);
    expect(body.message).toContain('Validation');
  });

  // 3. Not found
  it('should return 404 when resource not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const event = buildEvent({
      queryStringParameters: { orgId: 'org-123', id: 'nonexistent' },
    });

    const result = await <handlerName>(event);
    expect(result).toHaveProperty('statusCode', 404);
  });

  // 4. DynamoDB calls verification
  it('should call DynamoDB with correct parameters', async () => {
    mockSend.mockResolvedValueOnce({});

    const event = buildEvent({
      body: JSON.stringify({ orgId: 'org-123', name: 'Test' }),
    });

    await <handlerName>(event);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const putParams = mockSend.mock.calls[0][0].params;
    expect(putParams.TableName).toBe('test-table');
  });
});
```

## 3. What to Test for Every Handler

| Category | What to verify |
|---|---|
| Happy path | Correct input → expected output + status code |
| Validation | Invalid/missing fields → 400 with error details |
| Not found | Missing resource → 404 |
| Guard clauses | Business rules enforced (e.g., status checks) |
| DynamoDB calls | Correct table, keys, expressions |
| Edge cases | Optional fields missing, empty arrays, etc. |
| Audit context | `setAuditContext` called with correct action |

## 4. Hard Rules

- **Mock middy, AWS SDK, and Sentry BEFORE imports** — Jest hoists mocks
- **Test the exported function directly** — not the middy-wrapped `handler`
- **Reset mocks in `beforeEach`** — `jest.clearAllMocks()` + `mockSend.mockReset()`
- **Use `expect.any(String)` for timestamps** — never hardcode dates
- **Mock uuid** — return deterministic values for assertions
- **Never test middy middleware chain** — test business logic only

## 5. Run Tests

```bash
cd apps/functions && pnpm test -- --testPathPattern="<handler>.test"
```
