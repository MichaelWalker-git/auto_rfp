# Backend Architecture

> Guidelines for Lambda handlers, services, and business logic organization.

---

## ⚡ Lambda Handlers

- **Lambdas MUST be slim/thin.** They are responsible only for:
  1. Parsing the incoming event (extracting path params, query params, body)
  2. Calling the appropriate service/helper function
  3. Returning the formatted HTTP response

- **NO business logic in Lambda handlers.** All business logic lives in `apps/functions/helpers/` and domain-specific service files.

- **Zod `safeParse` results MUST always be destructured immediately** — never access `.success`, `.data`, or `.error` via the intermediate variable:
  ```typescript
  // ✅ correct
  const { success, data, error } = MySchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  // ❌ wrong — do not keep a named intermediate
  const parsed = MySchema.safeParse(raw);
  if (!parsed.success) { ... }
  const value = parsed.data;
  ```
  When you need to rename `data` for clarity, use an alias: `const { success, data: dto, error } = ...`.

- **`orgId` is NEVER read from the JWT token.** It must come from the request itself:
  - **Body** (preferred for POST/PUT/PATCH — include `orgId` in the request payload)
  - **Query string** (`?orgId=...` for GET/DELETE)
  - **Path parameter** (`/{orgId}/...` when scoped by org in the URL)
  Never read it from `event.auth?.claims` or any token field.
  ```typescript
  // ✅ correct — from body (POST/PUT)
  const orgId = data.orgId ?? event.queryStringParameters?.orgId;
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  // ✅ correct — from query param (GET)
  const { orgId, projectId } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  // ❌ wrong — from token/auth context
  const orgId = event.auth?.orgId;
  const orgId = event.auth?.claims?.['custom:orgId'];
  ```

- **Always use `apiResponse` from `@/helpers/api`** for all HTTP responses in REST Lambda handlers. Never construct raw response objects (`{ statusCode, headers, body }`) inline.
  ```typescript
  // ✅ correct
  return apiResponse(200, { items });
  return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  // ❌ wrong
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) };
  ```
  Note: WebSocket handlers (`$connect`, `$disconnect`, `$default`) return plain `{ statusCode, body }` objects directly — `apiResponse` is for REST handlers only.

- Each handler is organized by domain under `apps/functions/<domain>/`.

- **Every Lambda MUST have an explicit CloudWatch Log Group** defined in CDK with controlled retention (2 weeks for non-prod, retained for prod).

---

## 🧠 Business Logic & Services

- All business logic lives in **`apps/functions/helpers/`** and domain-specific files.
- Services are organized by domain within the functions directory structure.
- Services receive validated, typed data — they never parse raw events.
- Services interact with DynamoDB, Cognito, and other AWS services.

---

## 👤 User Management

- **Users MUST be created in both DynamoDB AND Cognito.**
- When creating a user:
  1. Create the user in Cognito (via `@aws-sdk/client-cognito-identity-provider`)
  2. Store the user record in DynamoDB with the Cognito `sub` as the user ID
- User deletion should clean up both Cognito and DynamoDB.
