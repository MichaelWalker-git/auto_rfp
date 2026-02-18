# DynamoDB Design

> Single-table design patterns and access patterns.

---

## 🗄️ Single-Table Design

- We use a **single-table design** with a shared DynamoDB table.

- **PK (Partition Key)**: Use constants from `PK` object — **no magic strings**.
  - `PK.USER`, `PK.ORGANIZATION`, `PK.PROJECT`, etc. (defined in `apps/functions/constants/`)

- **SK (Sort Key)**: Composite key with `#` separator, built via helper functions.
  - Pattern: `{orgId}#{projectId}#{entityId}` (empty segments are omitted)
  - Use helper functions — never construct SK strings manually.

- **Multitenancy**: All entities support optional `orgId` as the first SK segment.
  - `orgId` scopes data to an organization. When empty, data is global.
  - Example: `PK = PK.USER`, `SK = "org123#proj456#user789"`
  - Query by org: `skPrefix = "org123"`, by org+project: `skPrefix = "org123#proj456"`

- Each entity has key builder functions in their respective function handlers.

- GSI1 can be used for access patterns that reverse PK/SK.

- All DynamoDB operations go through helper functions in `apps/functions/helpers/`.

- All services accept `orgId` as a parameter (can be undefined for global scope).
