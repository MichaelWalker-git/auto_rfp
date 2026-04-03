---
name: review-conventions
description: Convention compliance review against project rules - TypeScript, backend patterns, frontend patterns, DynamoDB design
---

# Convention Compliance Review

Check all changed code against project conventions defined in `.claude/rules/`.

## Process

1. Get the diff: `git diff develop...HEAD`
2. Check every changed line against the rules below

### TypeScript Rules (from 02-typescript-best-practices.md)

| ID | Rule | Search pattern |
|---|---|---|
| T1 | No `any` type | `: any`, `as any`, `<any>`, `Record<string, any>` |
| T2 | Types from Zod | Manual `interface`/`type` for domain types instead of `z.infer<>` |
| T3 | `const` arrow functions | `function` keyword (except Next.js `export default function`) |
| T4 | No `.js` extensions | `from './foo.js'` or `from '../bar.js'` |
| T5 | No `@ts-ignore` | `@ts-ignore` without justification |

### Backend Rules (from 04-backend-architecture.md)

| ID | Rule | Search pattern |
|---|---|---|
| B1 | Thin handlers | Business logic in handler files instead of helpers |
| B2 | Destructured `safeParse` | `const parsed = Schema.safeParse(...)` |
| B3 | `orgId` from request | `event.auth?.orgId`, `event.auth?.claims` |
| B4 | `apiResponse` for REST | Inline `{ statusCode, headers, body }` |
| B5 | No raw DynamoDB SDK | `DynamoDBClient`, `PutCommand` imports in handlers |
| B6 | Middy middleware stack | Missing or wrong order of middleware |
| B7 | Sentry wrapper | Handler not wrapped with `withSentryLambda` |

### Frontend Rules (from 06-frontend-architecture.md)

| ID | Rule | Search pattern |
|---|---|---|
| F1 | Shadcn UI components | Raw `<button>`, `<input>`, `<select>` |
| F2 | Skeleton loading | Spinners, "Loading..." text |
| F3 | `'use client'` directive | Interactive components missing directive |
| F4 | Feature-Sliced Design | Components outside `features/` or `components/` |
| F5 | Types from core | Inline interfaces duplicating core schemas |
| F6 | No logic in components | API calls or complex logic in component files |

### DynamoDB Rules (from 05-dynamodb-design.md)

| ID | Rule | Search pattern |
|---|---|---|
| D1 | PK constants | Magic string PKs instead of constants |
| D2 | SK builder functions | Manual SK string construction |
| D3 | DB helpers | Raw DynamoDB operations in handlers |

## Output

```
## Convention Compliance Report

### Violations
| # | Rule | File:Line | Issue | Fix |
|---|---|---|---|---|
| 1 | T1 | `path:42` | Uses `as any` | Use specific type assertion |

### Compliance Summary
| Category | Pass | Fail | N/A |
|---|---|---|---|
| TypeScript (T1-T5) | X | Y | Z |
| Backend (B1-B7) | X | Y | Z |
| Frontend (F1-F6) | X | Y | Z |
| DynamoDB (D1-D3) | X | Y | Z |
```