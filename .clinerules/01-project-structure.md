# Project Structure

> Defines the monorepo organization and directory conventions.

---

## 📁 Directory Layout

- **`apps/`** — Deployable applications (follows Turborepo convention)
  - `apps/web/` — Next.js App Router frontend (`@auto-rfp/web`)
  - `apps/functions/` — AWS Lambda handlers (`@auto-rfp/functions`)
- **`packages/`** — Shared libraries & tooling
  - `packages/core/` — Shared Zod schemas & TypeScript types (`@auto-rfp/core`)
  - `packages/infra/` — AWS CDK infrastructure stacks (`@auto-rfp/infra`)
- **`scripts/`** — Utility scripts for maintenance and migrations

---

## 🔧 General Conventions

- Use ESM (`"type": "module"`) everywhere.
- Target Node.js 20+ for Lambda runtime.
- Use `pnpm` as the package manager with workspaces.
- Prefer `const` over `let`; never use `var`.
- Use TypeScript strict mode in all packages.
- Destructure where possible for cleaner code.
- **Never use `.js` extensions in import paths.** Use `moduleResolution: "bundler"` in tsconfig.
