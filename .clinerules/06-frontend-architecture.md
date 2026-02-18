# Frontend Architecture

> Next.js App Router + Domain-Driven Design patterns.

---

## Framework & Structure

- **Framework**: Next.js 15+ with App Router
- **Path aliases**: Use `@/*` for all imports (e.g., `import { UserList } from '@/components/users/UserList'`)
- **Route groups**: `(auth)` and `(dashboard)` use different layouts without affecting URL paths
- **Auth guard**: Dashboard layout redirects to `/login` if not authenticated

---

## Component Architecture

### Server vs Client Components

- Root `layout.tsx` is a Server Component (defines metadata, wraps with Providers)
- All interactive components use `'use client'` directive
- `Providers.tsx` wraps the app with SWR config and Amplify initialization

### Feature Modules (Feature-Sliced Design)

Each domain has its own directory with clear subdirectories:

```
features/
├── users/
│   ├── components/       # Presentation-only components
│   │   └── UserList.tsx
│   ├── hooks/            # Feature-specific logic hooks
│   │   ├── useCreateUser.ts
│   │   └── useEditUser.ts
│   ├── lib/              # Helper functions and utilities
│   │   ├── validation.ts
│   │   └── formatting.ts
│   ├── types.ts          # Local types (only if not in @auto-rfp/core)
│   └── index.ts          # Barrel export
```

- **Components must be pure presentation** — no business logic, API calls, or routing
- **Keep components small and simple** — if a component exceeds 200 lines, split it into smaller components
- **Logic lives in feature hooks** in the `hooks/` subdirectory
- **Helper functions** (validation, formatting, calculations) go in the `lib/` subdirectory
- **Types should be imported from `@auto-rfp/core`** — only define local types if they're UI-specific and not part of the domain model
- **Barrel exports** (`index.ts`) — pages import from `@/features/users`, never from internal paths

---

## Pages & Routing

- **Create/Edit pages MUST be separate pages** — never inline forms in list pages or use dialogs/modals
  - Create: `/users/create` → `app/(dashboard)/users/create/page.tsx`
  - Edit: `/users/[id]/edit` → `app/(dashboard)/users/[id]/edit/page.tsx`
  - List pages link to create/edit pages via `<Link>` with breadcrumb navigation

---

## Data Fetching & State

- **Data fetching**: Use **SWR** with `authenticatedFetcher` for all client-side API calls
  - `useApi<T>(path)` — Generic hook for GET requests with caching
  - `apiMutate(path, options)` — Helper for POST/PUT/DELETE

- **Authentication**: Use **AWS Amplify** (`aws-amplify`) to authenticate with Cognito
  - `useAuth()` hook provides `signIn`, `signOut`, `isAuthenticated`, `username`
  - JWT tokens are automatically attached to API requests via `authenticatedFetcher`

- **Health check**: `useHealth()` hook polls `/health` every 30s
  - `HealthBanner` component shows an error banner when the API is unreachable

- **API Response Types**: All response types (`UsersResponse`, `UserResponse`, etc.) are defined in `@auto-rfp/core` — never define inline interfaces in components

---

## Forms

- Use **react-hook-form** with `@hookform/resolvers/zod` and Zod schemas from `@auto-rfp/core`
- Use `z.input<typeof Schema>` as the form type (handles `.default()` fields correctly)
- Use `zodResolver(Schema)` for validation
- No manual `useState` for form fields — use `register()` from react-hook-form

---

## UI & Styling

- **Styling**: Use **Tailwind CSS v4** — no raw CSS files. All styling via utility classes
  - Custom theme tokens defined in `globals.css` via `@theme` directive
  - Indigo (`indigo-500`) as primary color, Slate for neutrals, Emerald for success

- **UI Components**: Use **Shadcn UI** components from `@/components/ui/`
  - Components: `Button`, `Input`, `Select`, `Card`, `Badge`, `PageHeader`, `Breadcrumb`, etc.
  - **Never use raw HTML elements** for buttons, inputs, cards, etc. — always use the UI components
  - To swap the underlying component library, only change the `components/ui/` implementations

---

## Loading States

- **ALWAYS use skeleton components for loading states** — never use spinners or "Loading..." text

- **Page-level loading**: Use `PageLoadingSkeleton` from `@/components/layout/page-loading-skeleton`
  - Create `loading.tsx` files in route directories that render appropriate skeleton components
  - Skeleton variants: `list`, `grid`, `detail` — choose based on the content being loaded
  - Example: `<PageLoadingSkeleton variant="detail" hasDescription />` for detail pages

- **Component-level loading**: Use `Skeleton` from `@/components/ui/skeleton` for inline loading states

---

## Environment Variables

- Use `NEXT_PUBLIC_` prefix for client-side env vars
