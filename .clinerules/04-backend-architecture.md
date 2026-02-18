# Backend Architecture

> Guidelines for Lambda handlers, services, and business logic organization.

---

## ⚡ Lambda Handlers

- **Lambdas MUST be slim/thin.** They are responsible only for:
  1. Parsing the incoming event (extracting path params, query params, body)
  2. Calling the appropriate service/helper function
  3. Returning the formatted HTTP response

- **NO business logic in Lambda handlers.** All business logic lives in `apps/functions/helpers/` and domain-specific service files.

- Validation results should be destructured: `const { success, data, errors } = validateInput(...)`.

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
