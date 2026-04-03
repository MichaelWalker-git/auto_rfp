# Next.js Conventions

> Project-specific Next.js patterns for AutoRFP.

---

## Stack

- **Next.js 15+** with App Router
- **Tailwind CSS v4** for styling (indigo primary, slate neutrals)
- **Shadcn UI** components from `@/components/ui/`
- **SWR** for data fetching with `authenticatedFetcher`
- **AWS Amplify** for Cognito authentication
- **react-hook-form** + Zod for forms
- **nuqs** for URL query state

## Patterns

- Use `const` arrow functions for all components and hooks (except `export default function` for page/layout files).
- Use `'use client'` on all interactive components and hooks.
- Import types from `@auto-rfp/core` — never define domain types inline.
- Use `z.input<typeof Schema>` as the form type (handles `.default()` correctly).
- Use early returns and guard clauses for error conditions.
- Use dynamic imports for code splitting when appropriate.
- Favor named exports. Barrel exports via `index.ts` in feature modules.