# Entity Definitions

> Rules for defining domain entities using Zod schemas.

---

## 🧩 Schema Conventions

- **Every entity MUST be defined in `packages/core/` using Zod schemas.**
- TypeScript types are always inferred from Zod schemas using `z.infer<>` — never define types manually.
- Each entity gets its own file in `packages/core/src/schemas/<entity>.ts`.
- Schemas are re-exported automatically via the `export *` barrel in `packages/core/src/schemas/index.ts` — add an `export * from './<entity>'` line if the file is new.

---

## 📐 The 5-type entity pattern (REQUIRED for every stored entity)

Every persisted domain entity MUST expose exactly these five Zod schemas + inferred types, in this order, in its core schema file. This is the common interface all entities share — follow it so the shape is predictable across the codebase. Reference implementations: `organization.ts`, `project.ts`, `opportunity.ts`.

| # | Schema | Type | Purpose |
|---|--------|------|---------|
| 1 | `<Entity>CreateRequestSchema` | `<Entity>CreateRequest` | Incoming POST body. Omits server-managed fields (`id`/`oppId`, `createdAt`, `updatedAt`, audit names, sync/assignment markers). |
| 2 | `<Entity>UpdateRequestSchema` | `<Entity>UpdateRequest` | Incoming PATCH/PUT body. `.partial()`, with identifiers omitted (`id`/`orgId`/`projectId` etc. are not patchable). |
| 3 | `<Entity>ItemSchema` | `<Entity>Item` | **Pure domain entity** returned by the API. Contains `id` + domain fields + audit fields. MUST NOT contain `partition_key`/`sort_key`. |
| 4 | `<Entity>DBItemSchema` | `<Entity>DBItem` | DynamoDB record: `<Entity>ItemSchema` extended with the two single-table keys. Lives in **core**, not `apps/functions/src/types/`. |
| 5 | `<Entity>ListItemSchema` | `<Entity>ListItem` | Lightweight shape for list/grid/card/selector views. Include only the fields those components actually read. |

### Canonical skeleton

```typescript
import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';

// 1. Create request — server-managed fields omitted
export const FooCreateRequestSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type FooCreateRequest = z.infer<typeof FooCreateRequestSchema>;

// 2. Update request — partial, identifiers not patchable
export const FooUpdateRequestSchema = FooCreateRequestSchema.partial().omit({ orgId: true });
export type FooUpdateRequest = z.infer<typeof FooUpdateRequestSchema>;

// 3. Item — pure domain entity (NO db keys)
export const FooItemSchema = FooCreateRequestSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.string().optional(),
});
export type FooItem = z.infer<typeof FooItemSchema>;

// 4. DBItem — Item + single-table keys, using computed key names
export const FooDBItemSchema = FooItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});
export type FooDBItem = z.infer<typeof FooDBItemSchema>;

// 5. ListItem — lightweight projection for list/card views
export const FooListItemSchema = z.object({
  id: z.string(),
  orgId: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.string().optional(),
});
export type FooListItem = z.infer<typeof FooListItemSchema>;
```

### Naming — strict

- Use `<Entity>CreateRequest` / `<Entity>UpdateRequest`. **Do NOT** use the legacy `CreateXxxDTO` / `UpdateXxxDTO` / `CreateXxxSchema` / `UpdateXxxSchema` names — they are deprecated and being removed.
- The DB key names come from `PK_NAME`/`SK_NAME` exported by `packages/core/src/constants.ts` (the single source of truth). Always write `[PK_NAME]: z.string()` / `[SK_NAME]: z.string()` in DBItem schemas — never the raw string literals `partition_key` / `sort_key`.
- `apps/functions/src/constants/common.ts` re-exports `PK_NAME`/`SK_NAME` from `@auto-rfp/core`, so backend code keeps importing them from `@/constants/common`.

---

## 🔑 Where each type is used

- **`<Entity>CreateRequest(Schema)`** — the create handler's `safeParse`, and the frontend create form/hook's client-side validation.
- **`<Entity>UpdateRequest(Schema)`** — the update handler's patch validation (wrap in `{ id, patch: <Entity>UpdateRequestSchema }` if the route needs identifiers alongside the patch).
- **`<Entity>Item`** — API responses, detail pages, context providers, anything handling the full entity.
- **`<Entity>DBItem`** — backend helpers/handlers that read or write the raw DynamoDB record (i.e. anything that touches `partition_key`/`sort_key`). Import it from `@auto-rfp/core` — do **not** redefine `type XxxDBItem = XxxItem & DBItem` in `apps/functions/src/types/`.
- **`<Entity>ListItem`** — list/grid/card/selector components. Full `<Entity>Item[]` from a list endpoint is structurally assignable to `<Entity>ListItem[]`, so list containers can keep fetching full items and pass them to `ListItem`-typed presentational components without casts.

### When ListItem isn't worth narrowing

If a "card" reads almost every field of the entity (a rich card, not a thin row), still **define** `<Entity>ListItemSchema` for interface consistency, but it's acceptable to keep that specific component on `<Entity>Item` rather than forcing a near-duplicate. Document the deviation in the PR. Never skip defining the type, though.

---

## ✅ Migration / review checklist for a new or refactored entity

- [ ] All five schemas + inferred types present, correctly named.
- [ ] `<Entity>Item` has NO `partition_key`/`sort_key`.
- [ ] `<Entity>DBItem` uses `[PK_NAME]`/`[SK_NAME]`, lives in core, and the backend imports it (no local `& DBItem` alias).
- [ ] No `CreateXxxDTO`/`UpdateXxxDTO`/`CreateXxxSchema`/`UpdateXxxSchema` names remain.
- [ ] Create handler validates against `<Entity>CreateRequestSchema`; update handler against `<Entity>UpdateRequestSchema` (destructured `safeParse`).
- [ ] List/card components use `<Entity>ListItem` (or a documented exception).
- [ ] `packages/core` rebuilt (`pnpm --filter @auto-rfp/core build`) before dependent typechecks.