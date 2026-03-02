# Testing

> Rules for writing and maintaining tests across the project.

---

## 🧪 Core Principle

- **Every new handler, helper, or component MUST have corresponding tests.** Never generate code without also generating or updating its test file.
- Tests are co-located with the source file they test (e.g., `create-foia-request.ts` → `create-foia-request.test.ts`).

---

## ⚡ Backend Tests (`apps/functions/`)

- **Framework**: Jest with TypeScript
- **Test file naming**: `<handler-name>.test.ts` in the same directory as the handler
- **Mock pattern**: Mock AWS SDK and middy at the top of every test file before imports:
  ```typescript
  // ✅ correct — mock middy before importing handlers
  jest.mock('@middy/core', () => {
    const middy = (handler: unknown) => ({
      use: jest.fn().mockReturnThis(),
      handler,
    });
    return { __esModule: true, default: middy };
  });

  // Mock AWS SDK
  const mockSend = jest.fn();
  jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({})),
  }));

  jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
      from: jest.fn(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn((params) => ({ type: 'Put', params })),
    GetCommand: jest.fn((params) => ({ type: 'Get', params })),
    // ... other commands as needed
  }));

  // Set required environment variables
  process.env.DB_TABLE_NAME = 'test-table';
  process.env.REGION = 'us-east-1';
  ```

- **Test the exported function, not the handler wrapper.** Import and test `createFOIARequest`, `updateFOIARequest`, `generateFOIALetter`, etc. — not the middy-wrapped `handler`.
  ```typescript
  // ✅ correct — test the business function directly
  import { createFOIARequest } from './create-foia-request';
  const result = await createFOIARequest(dto, 'user-789');

  // ❌ wrong — testing the middy-wrapped handler requires full event simulation
  import { handler } from './create-foia-request';
  ```

- **Reset mocks in `beforeEach`**:
  ```typescript
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });
  ```

- **What to test for every handler:**
  1. Happy path — correct input produces expected output
  2. Validation — invalid input returns 400 with error details
  3. Not found — missing resources return 404
  4. Guard clauses — business rules enforced (e.g., LOST status check)
  5. DynamoDB calls — correct table name, keys, and expressions
  6. Edge cases — optional fields missing, empty arrays, etc.

---

## 🧩 Schema Tests (`packages/core/`)

- **Framework**: Vitest
- **Test file naming**: `<schema-name>.test.ts` in the same directory
- **What to test:**
  1. Valid data passes `safeParse`
  2. Invalid data fails `safeParse` with correct error
  3. Default values are applied correctly
  4. Optional fields can be omitted
  5. Enum values are validated
  6. Helper functions produce correct results

---

## 🌐 Frontend Tests (`apps/web/`)

- **Framework**: Jest with React Testing Library
- **Test file location**: `__tests__/` subdirectory next to the component
- **What to test:**
  1. Component renders without crashing
  2. Loading states show skeletons (not spinners)
  3. Empty states display correct messaging
  4. User interactions trigger correct callbacks
  5. Permission guards hide/show elements correctly
  6. Form validation displays error messages

---

## 📋 When to Update Tests

- **New handler created** → Create `<handler>.test.ts` with all test categories above
- **Handler logic changed** → Update existing tests to cover new behavior
- **Schema changed** → Update schema tests for new fields/validations
- **Component refactored** → Update component tests for new behavior
- **Bug fixed** → Add a regression test that would have caught the bug

---

## ❌ Common Testing Mistakes

| Mistake | Correct approach |
|---|---|
| No tests for new code | Always create tests alongside new handlers/components |
| Testing only happy path | Include validation, not-found, guard clause, and edge case tests |
| Not mocking AWS SDK | Mock all AWS SDK clients before imports |
| Testing middy-wrapped handler | Test the exported business function directly |
| Hardcoded dates in assertions | Use `expect.any(String)` for timestamps |
| Not resetting mocks | Always `jest.clearAllMocks()` in `beforeEach` |
