---
name: zod-schema
description: Create a new Zod schema in packages/core with proper types, Create/Update DTOs, and barrel exports
---

# Zod Schema Creation

When creating a new entity schema in this project, follow these exact steps:

## 1. Create the Schema File

Create `packages/core/src/schemas/<entity>.ts`:

```typescript
import { z } from 'zod';

// --- Item Schema (full DynamoDB record) ---
export const <Entity>ItemSchema = z.object({
  partition_key: z.string().optional(),
  sort_key: z.string().optional(),
  id: z.string().uuid(),
  orgId: z.string().uuid().optional(),
  // ... entity-specific fields ...
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type <Entity>Item = z.infer<typeof <Entity>ItemSchema>;

// --- Create DTO (omit id + timestamps) ---
export const Create<Entity>Schema = <Entity>ItemSchema.omit({
  partition_key: true,
  sort_key: true,
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Create<Entity>DTO = z.infer<typeof Create<Entity>Schema>;

// --- Update DTO (partial of Create) ---
export const Update<Entity>Schema = Create<Entity>Schema.partial();

export type Update<Entity>DTO = z.infer<typeof Update<Entity>Schema>;
```

## 2. Export from Barrel

Add to `packages/core/src/schemas/index.ts`:
```typescript
export * from './<entity>';
```

## 3. Hard Rules

- **ALL types MUST be inferred from Zod** using `z.infer<typeof Schema>` — never define types manually
- Use `z.string().uuid()` for all ID fields
- Use `z.string().datetime()` for timestamp fields
- Use `z.enum([...])` for status fields — never string unions
- Use `.optional()` for nullable fields — never `z.nullable()`
- Use `.default()` for fields with default values
- Use `.trim()` on string fields that accept user input
- Add `.min()` / `.max()` validators with descriptive error messages
- Use `const` arrow functions — never `function` keyword

## 4. Verify

```bash
cd packages/core && pnpm tsc --noEmit
```

## 5. Create Tests

Create `packages/core/src/schemas/<entity>.test.ts` using Vitest:
- Valid data passes `safeParse`
- Invalid data fails with correct errors
- Default values applied correctly
- Optional fields can be omitted
- Enum values validated
