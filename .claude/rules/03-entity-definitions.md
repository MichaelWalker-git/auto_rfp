# Entity Definitions

> Rules for defining domain entities using Zod schemas.

---

## 🧩 Schema Conventions

- **Every entity MUST be defined in `packages/core/` using Zod schemas.**
- TypeScript types are always inferred from Zod schemas using `z.infer<>` — never define types manually.
- Each entity gets its own file in `packages/core/src/schemas/`.
- Schemas must be re-exported from `packages/core/src/index.ts`.
- Use `CreateXxxSchema` (omit id + timestamps) and `UpdateXxxSchema` (partial) patterns for CRUD.

---

## 🗄️ DynamoDB Item Types

If an entity schema does not include `partition_key` and `sort_key` properties, define a separate `EntityNameDBItem` type in `apps/functions/src/types/` that extends the base entity type with DynamoDB keys:

```typescript
import { PK_NAME, SK_NAME } from '@/constants/common';
import { EntityItem } from '@auto-rfp/core';

export type EntityDBItem = EntityItem & {
  [PK_NAME]: string;
  [SK_NAME]: string;
};
```

This allows type-safe access to DynamoDB keys without polluting the core schema with infrastructure concerns.
