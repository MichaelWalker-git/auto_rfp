# TypeScript Best Practices

> Strict TypeScript guidelines to ensure type safety and code quality.

---

## 🎯 Core Principles

- **NEVER use `any` type.** Always use proper types, `unknown`, or type assertions when absolutely necessary.
  - If you need to cast, use specific type assertions (e.g., `as DocumentDBItem`) instead of `as any`.
  - Use `unknown` for truly unknown types and narrow them with type guards.

- **AVOID using `as Record<string, unknown>` or similar loose type assertions.**
  - Define proper types or interfaces for objects instead of using generic Record types.
  - If the structure is truly dynamic, use Zod schemas to validate and infer the type.
  - Exception: When working with third-party libraries that don't provide proper types.

- **NEVER define types manually without Zod schemas.**
  - All types MUST be inferred from Zod schemas using `z.infer<typeof Schema>`.
  - Exception: Infrastructure-specific types like `DocumentDBItem` that extend core types with DynamoDB keys.
  - This ensures runtime validation matches compile-time types.

- **Use type guards** for runtime type checking instead of type assertions when possible.

- **Prefer interfaces over types** for object shapes (except when inferring from Zod).

- **Use discriminated unions** for complex type scenarios instead of `any` or loose types.

## 🔧 Function Definitions

- **ALWAYS use `const` arrow functions** instead of the `function` keyword for all function definitions.
  - This applies to React components, hooks, helpers, and all other functions.
  - Exception: `export default function` for Next.js page/layout files (required by the framework).
  ```typescript
  // ✅ correct
  const MyComponent = () => { ... };
  const handleClick = (e: React.MouseEvent) => { ... };
  const formatDate = (date: string): string => { ... };

  // ❌ wrong
  function MyComponent() { ... }
  function handleClick(e: React.MouseEvent) { ... }
  function formatDate(date: string): string { ... }
  ```
