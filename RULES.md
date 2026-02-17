# Project Rules & Conventions

> This file is the single source of truth for project conventions.
> Update it every time a new rule or pattern is established.

---

## 📁 Project Structure

- **`apps/`** — Deployable applications (follows Turborepo convention)
  - `apps/web` — Next.js App Router frontend (`@template/web`)
  - `apps/functions` — AWS Lambda handlers (`@template/functions`)
- **`packages/`** — Shared libraries & tooling
  - `packages/core` — Shared Zod schemas & TypeScript types (`@template/core`)
  - `packages/infra` — AWS CDK infrastructure stacks (`@template/infra`)

---

## 🧩 Entity Definitions

- **Every entity MUST be defined in `packages/core` using Zod schemas.**
- TypeScript types are always inferred from Zod schemas using `z.infer<>` — never define types manually.
- Each entity gets its own file in `packages/core/src/entities/`.
- Schemas must be re-exported from `packages/core/src/schemas/index.ts`.
- Use `CreateXxxSchema` (omit id + timestamps) and `UpdateXxxSchema` (partial) patterns for CRUD.

---

## ⚡ Lambda Handlers

- **Lambdas MUST be slim/thin.** They are responsible only for:
  1. Parsing the incoming event (extracting path params, query params, body)
  2. Calling the appropriate service/helper function
  3. Returning the formatted HTTP response
- **NO business logic in Lambda handlers.** All business logic lives in `apps/functions/src/services/`.
- Validation results should be destructured: `const { success, data, errors } = validateInput(...)`.
- Each handler is in its own directory under `apps/functions/src/handlers/<handler-name>/index.ts`.
- **Every Lambda MUST have an explicit CloudWatch Log Group** defined in CDK with controlled retention (2 weeks for non-prod, retained for prod).

---

## 🧠 Business Logic & Services

- All business logic lives in **`apps/functions/src/services/`**.
- Services are organized by domain: `user.service.ts`, `product.service.ts`, etc.
- Services receive validated, typed data — they never parse raw events.
- Services interact with DynamoDB, Cognito, and other AWS services.

---

## 🗄️ DynamoDB Design (Single-Table)

- We use a **single-table design** with a shared DynamoDB table.
- **PK (Partition Key)**: Use constants from `PK` object — **no magic strings**.
  - `PK.USER`, `PK.PRODUCT`, etc. (defined in `packages/core/src/entities/common.ts`)
- **SK (Sort Key)**: Composite key with `#` separator, built via `buildSk()`.
  - Pattern: `{orgId}#{projectId}#{entityId}` (empty segments are omitted)
  - Use `buildSk()` and `parseSk()` helpers — never construct SK strings manually.
- **Multitenancy**: All entities support optional `orgId` as the first SK segment.
  - `orgId` scopes data to an organization. When empty, data is global.
  - Example: `PK = PK.USER`, `SK = "org123#proj456#user789"`
  - Query by org: `skPrefix = "org123"`, by org+project: `skPrefix = "org123#proj456"`
- Each entity has key builder functions:
  - `buildUserKey(userId, orgId?, projectId?)` → `{ pk, sk }`
  - `buildProductKey(productId, orgId?)` → `{ pk, sk }`
  - `buildXxxSkPrefix(orgId?, ...)` → prefix string for queries
- GSI1 can be used for access patterns that reverse PK/SK.
- All DynamoDB operations go through helper functions in `apps/functions/src/lib/dynamo.ts`.
- All services accept `orgId` as a parameter (can be undefined for global scope).

---

## 👤 User Management

- **Users MUST be created in both DynamoDB AND Cognito.**
- When creating a user:
  1. Create the user in Cognito (via `@aws-sdk/client-cognito-identity-provider`)
  2. Store the user record in DynamoDB with the Cognito `sub` as the user ID
- User deletion should clean up both Cognito and DynamoDB.

---

## 🌐 Frontend Deployment

- **Frontend is deployed via AWS Amplify Hosting** (not S3 + CloudFront).
- The CDK stack uses `@aws-cdk/aws-amplify-alpha` to define the Amplify app.
- The built `apps/web/dist` is deployed as an S3 asset to an Amplify branch.

---

## 🏗️ Infrastructure (CDK)

- All infrastructure is defined in `packages/infra/src/stacks/`.
- Stacks are organized by concern:
  - `api-stack.ts` — API Gateway + Lambda functions
  - `data-stack.ts` — DynamoDB table + GSIs
  - `auth-stack.ts` — Cognito User Pool + Client
  - `web-stack.ts` — Amplify Hosting for frontend
- Stack outputs are used to pass values between stacks (e.g., table name, user pool ID).
- Environment variables are passed to Lambda functions for resource references.
- Multi-stage support via `-c stage=dev|staging|prod`.

---

## 🌐 Frontend Architecture (`apps/web`) — Next.js App Router + DDD

- **Framework**: Next.js 15+ with App Router, static export (`output: 'export'`).
- **Folder structure** (DDD-inspired with route groups):
  ```
  src/
  ├── app/                        # Next.js App Router
  │   ├── layout.tsx              # Root layout (Providers only)
  │   ├── not-found.tsx           # Global 404
  │   ├── globals.css
  │   ├── (auth)/                 # Auth route group (no sidebar)
  │   │   ├── layout.tsx          # Centered auth layout
  │   │   └── login/page.tsx
  │   └── (dashboard)/            # Dashboard route group (with sidebar)
  │       ├── layout.tsx          # Sidebar + auth guard + health banner
  │       ├── page.tsx            # Home / dashboard overview
  │       ├── users/page.tsx      # Users page
  │       ├── products/page.tsx   # Products page
  │       ├── error.tsx           # Dashboard error boundary
  │       └── loading.tsx         # Dashboard loading state
  ├── features/                   # Domain feature modules (DDD)
  │   ├── users/UserList.tsx
  │   └── products/ProductList.tsx
  ├── shared/                     # Shared UI components
  │   ├── Providers.tsx           # SWR + Amplify config
  │   ├── Sidebar.tsx             # Navigation sidebar
  │   └── HealthBanner.tsx        # API health status
  ├── hooks/                      # Custom React hooks
  └── lib/                        # Configuration & utilities
  ```
- **Route groups**: `(auth)` and `(dashboard)` use different layouts without affecting URL paths.
- **Auth guard**: Dashboard layout redirects to `/login` if not authenticated.
- **Feature modules** (Feature-Sliced Design): Each domain has its own directory with clear subdirectories:
  ```
  features/
  ├── users/
  │   ├── components/       # Presentation-only components
  │   │   └── UserList.tsx
  │   ├── hooks/            # Feature-specific logic hooks
  │   │   ├── useCreateUser.ts
  │   │   └── useEditUser.ts
  │   └── index.ts          # Barrel export
  └── products/
      ├── components/
      │   └── ProductList.tsx
      └── index.ts
  ```
  - **Components must be pure presentation** — no business logic, API calls, or routing.
  - **Logic lives in feature hooks** in the `hooks/` subdirectory.
  - **Barrel exports** (`index.ts`) — pages import from `@/features/users`, never from internal paths.
- **Server vs Client Components**:
  - Root `layout.tsx` is a Server Component (defines metadata, wraps with Providers).
  - All interactive components use `'use client'` directive.
  - `Providers.tsx` wraps the app with SWR config and Amplify initialization.
- **Path aliases**: Use `@/*` for imports (e.g., `import { UserList } from '@/features/users/UserList'`).
- **Create/Edit pages MUST be separate pages** — never inline forms in list pages or use dialogs/modals.
  - Create: `/users/create` → `src/app/(dashboard)/users/create/page.tsx`
  - Edit: `/users/[id]/edit` → `src/app/(dashboard)/users/[id]/edit/page.tsx`
  - List pages link to create/edit pages via `<Link>` with a breadcrumb back link.
- **Data fetching**: Use **SWR** with `authenticatedFetcher` for all client-side API calls.
  - `useApi<T>(path)` — Generic hook for GET requests with caching.
  - `apiMutate(path, options)` — Helper for POST/PUT/DELETE.
- **Authentication**: Use **AWS Amplify** (`aws-amplify`) to authenticate with Cognito.
  - `useAuth()` hook provides `signIn`, `signOut`, `isAuthenticated`, `username`.
  - JWT tokens are automatically attached to API requests via `authenticatedFetcher`.
- **Health check**: `useHealth()` hook polls `/health` every 30s.
  - `HealthBanner` component shows an error banner when the API is unreachable.
- **Styling**: Use **Tailwind CSS v4** — no raw CSS files. All styling via utility classes.
  - Custom theme tokens defined in `globals.css` via `@theme` directive.
  - Indigo (`indigo-500`) as primary color, Slate for neutrals, Emerald for success.
- **UI Abstraction Layer** (`src/shared/ui/`):
  - All reusable UI primitives live in `src/shared/ui/` and are exported from `src/shared/ui/index.ts`.
  - Components: `Button`, `Input`, `Select`, `Card`, `Badge`, `PageHeader`, `Breadcrumb`, `FormCard`.
  - Pages import from `@/shared/ui` — **never use raw HTML elements for buttons, inputs, cards, etc.**
  - To swap the underlying component library, only change the `shared/ui/` implementations.
- **Forms**: Use **react-hook-form** with `@hookform/resolvers/zod` and Zod schemas from `@template/core`.
  - Use `z.input<typeof Schema>` as the form type (handles `.default()` fields correctly).
  - Use `zodResolver(Schema)` for validation.
  - No manual `useState` for form fields — use `register()` from react-hook-form.
- **API Response Types**: All response types (`UsersResponse`, `UserResponse`, `ProductsResponse`, etc.) are defined in `@template/core` — never define inline interfaces in components.
- **Environment variables**: Use `NEXT_PUBLIC_` prefix for client-side env vars.

---

## 🚀 CI/CD (GitHub Actions)

- **Branching strategy**:
  - `develop` — Development branch (deploys to **dev** environment)
  - `main` — Test branch (deploys to **test** environment)
  - Feature branches → PR to `develop`
  - `develop` → PR to `main` for promotion to test
- **Workflows** (`.github/workflows/`):
  - `ci.yml` — Runs on every push/PR to `develop` and `main`: install → build → test → upload artifacts
  - `deploy-dev.yml` — Triggered on push to `develop`: builds and deploys all CDK stacks with `-c stage=dev`
  - `deploy-test.yml` — Triggered on push to `main`: builds and deploys all CDK stacks with `-c stage=test`
- **AWS authentication**: Uses OIDC (`id-token: write`) with `aws-actions/configure-aws-credentials@v4`.
  - Requires `AWS_ROLE_ARN` secret and optional `AWS_REGION` variable per GitHub environment.
- **GitHub Environments**: `dev` and `test` environments should be configured in repo settings with appropriate secrets.
- **Concurrency**: CI jobs cancel in-progress runs; deploy jobs do NOT cancel (to avoid partial deployments).
- **Caching**: pnpm store is cached between runs for faster installs.

---

## 🔧 General Conventions

- Use ESM (`"type": "module"`) everywhere.
- Target Node.js 20+ for Lambda runtime.
- Use `pnpm` as the package manager with workspaces.
- Prefer `const` over `let`; never use `var`.
- Use TypeScript strict mode in all packages.
- Destructure where possible for cleaner code.
- **Never use `.js` extensions in import paths.** Use `moduleResolution: "bundler"` in tsconfig.
