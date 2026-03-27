---
name: dynamodb-helper
description: Create DynamoDB helper functions with SK builders, CRUD operations, and query patterns for single-table design
---

# DynamoDB Helper Creation

When creating DynamoDB helpers for a new entity, follow these exact steps:

## 1. Create Constants

Create `apps/functions/src/constants/<entity>.ts`:

```typescript
export const <ENTITY>_PK = '<ENTITY>';
```

Reference `apps/functions/src/constants/common.ts` for `PK_NAME` and `SK_NAME`.

## 2. Create Helper File

Create `apps/functions/src/helpers/<entity>.ts`:

```typescript
import { createItem, getItem, putItem, deleteItem, queryBySkPrefix } from '@/helpers/db';
import { <ENTITY>_PK } from '@/constants/<entity>';
import { PK_NAME, SK_NAME } from '@/constants/common';
import type { <Entity>Item } from '@auto-rfp/core';

// --- SK Builders (pure functions, no side effects) ---

export const build<Entity>SK = (orgId: string, entityId: string): string =>
  `${orgId}#${entityId}`;

export const build<Entity>SKPrefix = (orgId: string): string => orgId;

// --- CRUD Operations ---

export const create<Entity> = (item: <Entity>Item) =>
  createItem(<ENTITY>_PK, build<Entity>SK(item.orgId!, item.id), item);

export const get<Entity> = (orgId: string, entityId: string) =>
  getItem<<Entity>Item>(<ENTITY>_PK, build<Entity>SK(orgId, entityId));

export const put<Entity> = (item: <Entity>Item) =>
  putItem({
    [PK_NAME]: <ENTITY>_PK,
    [SK_NAME]: build<Entity>SK(item.orgId!, item.id),
    ...item,
  });

export const list<Entities> = (orgId: string) =>
  queryBySkPrefix<<Entity>Item>(<ENTITY>_PK, build<Entity>SKPrefix(orgId));

export const delete<Entity> = (orgId: string, entityId: string) =>
  deleteItem(<ENTITY>_PK, build<Entity>SK(orgId, entityId));
```

## 3. SK Pattern Rules

- **Composite key with `#` separator**: `{orgId}#{projectId}#{entityId}`
- **Empty segments are omitted** — if no projectId, use `{orgId}#{entityId}`
- **Use helper functions** — never construct SK strings manually in handlers
- **Multitenancy**: `orgId` is always the first SK segment
- **Query by prefix**: `skPrefix = orgId` for all entities in an org

## 4. Available DB Operations

From `apps/functions/src/helpers/db.ts`:
- `createItem(pk, sk, item)` — PutItem with condition (fails if exists)
- `putItem(item)` — PutItem (upsert, overwrites)
- `getItem<T>(pk, sk)` — GetItem
- `deleteItem(pk, sk)` — DeleteItem
- `queryBySkPrefix<T>(pk, skPrefix)` — Query with begins_with on SK
- `updateItem(pk, sk, updates)` — UpdateItem with expression builder

## 5. Hard Rules

- **Use PK constants** — never hardcode partition key strings
- **SK builders are pure functions** — no DB calls, no side effects
- **All DB operations go through helpers** — never use DynamoDB SDK directly in handlers
- **All services accept `orgId`** as a parameter (can be undefined for global scope)
- **Use `const` arrow functions** — never `function` keyword

## 6. Verify

```bash
cd apps/functions && pnpm tsc --noEmit
```
