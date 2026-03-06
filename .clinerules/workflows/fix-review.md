# Fix Review Issues Workflow — Resolve Code Review Findings

> This workflow guides the AI through fixing issues identified in a code review report.
> It takes a `docs/reviews/<TARGET>-review-YYYY-MM-DD.md` file and systematically resolves all findings by severity.
>
> **Trigger**: Ask Cline/Claude to "fix [review report]" — e.g. "fix the clustering review", "fix docs/reviews/clustering-feature-review-2026-03-05.md", "fix all critical and high issues from the clustering review".

---

## 🎯 Goal

Take a code review report from `docs/reviews/` and produce all the code changes needed to resolve the identified issues — working from highest severity to lowest, verifying each fix, and updating the report checklist as items are completed.

---

## 📋 Pre-flight Checklist

Before starting, confirm:
- [ ] The review report exists in `docs/reviews/`
- [ ] You have read the full report including all findings and the action items checklist
- [ ] You understand which files are affected (check the "Files Reviewed" table)
- [ ] You have read the relevant `.clinerules/` files for the conventions being enforced
- [ ] You know the scope of fixes requested (all issues, or only specific severities)

---

## 📦 Fix Order

Always fix in this order — highest severity first, and within each severity, follow the dependency order.

```
1. 🔴 CRITICAL  →  Must fix first (security, data integrity, broken wiring)
2. 🟠 HIGH      →  Fix next (convention violations, missing tests, missing audit)
3. 🟡 MEDIUM    →  Fix when touching the file (code quality, minor patterns)
4. 🔵 LOW       →  Fix if time permits (style, suggestions)
```

Within each severity level, fix in this dependency order:

```
1. Core schemas (packages/core)     →  Types flow to everything else
2. Constants & helpers (functions)   →  Handlers depend on these
3. Lambda handlers (functions)       →  Frontend depends on API contract
4. CDK routes (infra)               →  Must match handlers
5. Frontend hooks (web)             →  Components depend on these
6. Frontend components (web)        →  End of the chain
7. Tests (all packages)             →  Written last to match final code
```

---

## Step 1 — Parse the Review Report

**What to do:**
1. Read the review report file
2. Extract the action items checklist
3. Group findings by severity (CRITICAL → HIGH → MEDIUM → LOW)
4. Identify dependencies between findings (e.g., "fix schema first, then handler, then test")
5. Create a fix plan with the ordered list of changes

**Output:** A numbered list of fixes to apply, in order.

---

## Step 2 — Fix Critical Issues (🔴)

**What to do:**
1. Read each CRITICAL finding carefully
2. Understand the impact and the suggested fix
3. Apply the fix exactly as described, or improve upon it if the suggestion is incomplete
4. Verify the fix compiles: `cd <package> && pnpm tsc --noEmit`

**Rules:**
- CRITICAL fixes must not introduce new issues
- If a CRITICAL fix requires changes in multiple files, make all changes before moving on
- If a CRITICAL fix conflicts with another finding, resolve the CRITICAL one first
- Always verify compilation after each CRITICAL fix

**After each fix:**
- Update the review report checklist: change `- [ ]` to `- [x]` for the completed item
- Add a brief note of what was changed

---

## Step 3 — Fix High Issues (🟠)

**What to do:**
1. Work through each HIGH finding in dependency order
2. For **missing tests**: create test files following `.clinerules/09-testing.md` patterns
3. For **missing audit logs**: add `auditMiddleware()` and `setAuditContext()` per `.clinerules/10-audit-trail.md`
4. For **type safety violations**: replace `any` with proper types, create typed error classes, etc.
5. For **architecture violations**: extract business logic to helpers, use `apiResponse`, etc.
6. For **performance issues**: optimize N+1 queries with batch operations

**Rules for creating tests:**
- Mock AWS SDK and middy at the top of every test file (before imports)
- Test the exported `baseHandler` function, not the middy-wrapped `handler`
- Cover: happy path, validation errors, not-found, guard clauses, edge cases
- Use `jest.clearAllMocks()` in `beforeEach`
- Use `expect.any(String)` for timestamps

**Rules for adding audit logs:**
- Add `auditMiddleware()` to the middy chain (before `httpErrorMiddleware()`)
- Add `setAuditContext(event, { action, resource, resourceId, changes })` in the handler
- For new audit actions, add them to `AuditActionSchema` in `packages/core/src/schemas/audit.ts`
- Use non-blocking `.catch()` pattern for high-frequency operations

**After each fix:**
- Update the review report checklist
- Verify compilation

---

## Step 4 — Fix Medium Issues (🟡)

**What to do:**
1. Work through each MEDIUM finding
2. These are typically code quality improvements that can be done quickly
3. Group related fixes (e.g., "convert all `function` declarations to arrow functions in the same file")

**Common MEDIUM fixes:**

| Finding Type | How to Fix |
|---|---|
| `function` keyword | Convert to `const fn = () => {}` |
| Manual interfaces | Replace with `z.infer<typeof Schema>` or import from `@auto-rfp/core` |
| `Record<string, unknown>` | Use proper DB item type with DynamoDB keys |
| `console.error` in production | Remove or replace with structured logging |
| Error message leakage | Sanitize error messages, remove internal details |
| Missing `orgId` | Extract from request using `getOrgId(event)` or body/query params |
| Component too long | Split into sub-components, extract logic to hooks |
| Pinecone metadata casts | Add Zod schema for runtime validation |

**After each fix:**
- Update the review report checklist

---

## Step 5 — Fix Low Issues (🔵)

**What to do:**
1. Work through each LOW finding if time permits
2. These are optional improvements — skip if the user only asked for critical/high fixes
3. Focus on removing dead code, consolidating duplicates, and improving naming

**After each fix:**
- Update the review report checklist

---

## Step 6 — Run Verification

**What to do:**
1. Run TypeScript compilation in all affected packages:
   ```bash
   cd packages/core && pnpm tsc --noEmit
   cd apps/functions && pnpm tsc --noEmit
   cd apps/web && pnpm tsc --noEmit
   ```

2. Run tests in affected packages:
   ```bash
   cd apps/functions && pnpm test -- --passWithNoTests
   cd packages/core && pnpm test -- --passWithNoTests
   ```

3. Re-run the automated checks from the review:
   ```bash
   # Verify no `any` remains in fixed files
   grep -rn ': any\|as any\|<any>' <fixed-files>
   
   # Verify no console.log in production
   grep -rn 'console\.log' <fixed-files> --include='*.ts' --include='*.tsx' | grep -v '.test.'
   
   # Verify all handlers have test files
   find <handler-dir> -name '*.ts' ! -name '*.test.ts' ! -name '*.d.ts' -exec sh -c 'test -f "${1%.ts}.test.ts" || echo "MISSING TEST: $1"' _ {} \;
   ```

4. If any check fails, go back and fix the issue before proceeding.

---

## Step 7 — Update the Review Report

**What to do:**
1. Open the review report file
2. Update the summary counts (reduce counts for fixed items)
3. Mark all completed items in the action items checklist
4. Add a "Fix Summary" section at the bottom:

```markdown
---

## 🔧 Fix Summary

**Date Fixed**: YYYY-MM-DD
**Fixed By**: Cline/Claude AI

### Changes Made

| Finding | Status | Files Changed |
|---|---|---|
| CR-1: <title> | ✅ Fixed | `file1.ts`, `file2.ts` |
| HI-1: <title> | ✅ Fixed | `file3.ts` |
| HI-2: <title> | ⏭️ Skipped (user requested critical/high only) | — |
| ME-1: <title> | ✅ Fixed | `file4.ts` |

### Verification Results

- [ ] TypeScript compilation passes in all packages
- [ ] All tests pass
- [ ] No `any` types in fixed files
- [ ] No `console.log` in production code
- [ ] All handlers have test files
```

---

## Step 8 — Present Results

After all fixes are applied:

1. **Summarize** what was fixed and what was skipped
2. **List** any new files created (especially test files)
3. **Highlight** any fixes that changed the API contract or behavior
4. **Recommend** whether a follow-up review is needed
5. **Offer** to fix remaining lower-severity items if they were skipped

---

## 🔄 Fix Variants

### Fix All
- Fix all findings from CRITICAL through LOW
- Full verification at the end
- Update the entire report

### Fix Critical + High Only
- Fix only 🔴 CRITICAL and 🟠 HIGH findings
- Skip MEDIUM and LOW
- Mark skipped items as "⏭️ Skipped" in the report

### Fix Specific Items
- User specifies which items to fix (e.g., "fix CR-1, HI-1, HI-5")
- Fix only those items
- Update only those checklist items

### Fix by Category
- User specifies a category (e.g., "fix all type safety issues", "fix all testing issues")
- Fix all findings in that category regardless of severity
- Update the report accordingly

---

## 🚨 Rules for Fixing

| Rule | Why |
|---|---|
| Never introduce new `any` types while fixing | Fixes should improve type safety, not degrade it |
| Never remove tests while fixing | Even if refactoring, update tests to match new code |
| Always update imports when moving code | Moving helpers to a new file requires updating all importers |
| Fix the root cause, not the symptom | If threshold constants are duplicated, consolidate — don't just align values |
| Preserve existing behavior | Unless the finding explicitly says behavior is wrong |
| Create tests for code you refactor | If you extract logic to a helper, write tests for the helper |
| Run compilation after every file change | Catch errors early, don't accumulate them |
| Update the review report as you go | Don't wait until the end — mark items done immediately |

---

## 🚨 Common Mistakes When Fixing

| Mistake | Correct approach |
|---|---|
| Fixing symptoms instead of root cause | If 4 files have different threshold values, consolidate to one source — don't just make them all match |
| Breaking existing tests | Run tests after each change; update test expectations if behavior intentionally changed |
| Forgetting to update imports | When moving a function to a helper file, update all files that imported it from the old location |
| Creating tests that only test happy path | Follow `.clinerules/09-testing.md` — test validation, errors, guard clauses, edge cases |
| Adding audit middleware without audit action | If the action doesn't exist in `AuditActionSchema`, add it first in `packages/core` |
| Fixing frontend without checking API contract | If you change a handler's response shape, update the frontend hook/component too |
| Not verifying compilation | Always `pnpm tsc --noEmit` after changes — TypeScript errors compound quickly |
| Marking items as fixed without actually fixing them | Only mark `- [x]` after the code change is saved and compiles |

---

## 📝 Example Usage

### Example 1: Fix all issues from a review
```
User: "Fix the clustering review"
→ Reads: docs/reviews/clustering-feature-review-2026-03-05.md
→ Fixes: All CRITICAL, HIGH, MEDIUM, LOW findings in order
→ Creates: Test files, helper files, updates handlers/components
→ Updates: The review report with fix summary
```

### Example 2: Fix only critical and high issues
```
User: "Fix critical and high issues from the clustering review"
→ Reads: docs/reviews/clustering-feature-review-2026-03-05.md
→ Fixes: Only CR-* and HI-* findings
→ Skips: ME-* and LO-* findings (marked as skipped)
→ Updates: The review report with fix summary
```

### Example 3: Fix specific items
```
User: "Fix CR-1 and HI-5 from the clustering review"
→ Reads: docs/reviews/clustering-feature-review-2026-03-05.md
→ Fixes: Only CR-1 (threshold consolidation) and HI-5 (as any in hooks)
→ Updates: Only those two checklist items
```

### Example 4: Fix by category
```
User: "Fix all type safety issues from the clustering review"
→ Reads: docs/reviews/clustering-feature-review-2026-03-05.md
→ Fixes: HI-5, HI-6, ME-1, ME-2, ME-3, ME-12 (all Type Safety category)
→ Updates: Those checklist items
```

---

## 🔗 Related Files

- `.clinerules/workflows/code-review.md` — Code review workflow (generates the reports this workflow consumes)
- `.clinerules/workflows/implementation.md` — Implementation workflow (for new features)
- `.clinerules/02-typescript-best-practices.md` — Type safety rules
- `.clinerules/04-backend-architecture.md` — Lambda handler conventions
- `.clinerules/06-frontend-architecture.md` — Frontend component patterns
- `.clinerules/09-testing.md` — Testing requirements
- `.clinerules/10-audit-trail.md` — Audit logging requirements
