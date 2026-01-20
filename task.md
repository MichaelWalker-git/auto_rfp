# AutoRFP Enhancement Tasks

This document tracks planned enhancements and improvements to the codebase.

## Task Status Legend
- [ ] Not started
- [x] Completed
- [~] In progress

---

## 1. Update CLAUDE.md Documentation
**Priority:** High | **Effort:** Low | **PR:** TBD

- [ ] Add findings from codebase analysis
- [ ] Document TypeScript strictness requirements
- [ ] Add testing patterns and best practices
- [ ] Document accessibility requirements

---

## 2. Lighthouse Accessibility Tests
**Priority:** High | **Effort:** Medium | **PR:** TBD

### 2.1 Setup
- [ ] Install @lhci/cli for Lighthouse CI
- [ ] Create lighthouserc.js configuration
- [ ] Add lighthouse npm scripts to web-app

### 2.2 Accessibility Thresholds
- [ ] Configure minimum accessibility score (target: 90+)
- [ ] Configure performance baseline
- [ ] Configure SEO baseline
- [ ] Configure best practices baseline

### 2.3 CI Integration
- [ ] Add Lighthouse CI to GitHub Actions workflow
- [ ] Configure assertions for PR blocking
- [ ] Set up accessibility report artifacts

---

## 3. Strict TypeScript Enforcement
**Priority:** Critical | **Effort:** High | **PR:** Multiple PRs recommended

### 3.1 Current State Analysis
- **web-app:** `strict: true` enabled, but ~50+ implicit any errors
- **infrastructure:** `strict: true` enabled, but relaxed settings:
  - `noUnusedLocals: false`
  - `noUnusedParameters: false`
  - `noFallthroughCasesInSwitch: false`
  - `strictPropertyInitialization: false`
- **shared:** `strict: true` enabled
- **Total `any` usages:** 223 occurrences across 97 files

### 3.2 Infrastructure Package (PR #1)
- [ ] Enable `noUnusedLocals: true`
- [ ] Enable `noUnusedParameters: true`
- [ ] Enable `noFallthroughCasesInSwitch: true`
- [ ] Enable `strictPropertyInitialization: true`
- [ ] Fix all resulting TypeScript errors
- [ ] Add ESLint rule: `@typescript-eslint/no-explicit-any`

### 3.3 Web-App Package - Fix Implicit Any (PR #2)
Files with implicit any issues:
- [ ] `app/organizations/[orgId]/projects/[projectId]/proposals/[proposalId]/page.tsx` (17 errors)
- [ ] `app/organizations/[orgId]/projects/[projectId]/questions/components/GenerateProposalModal.tsx` (16 errors)
- [ ] `app/organizations/[orgId]/projects/components/question-navigator.tsx` (2 errors)
- [ ] `components/brief/helpers.ts` (4 errors)

### 3.4 Web-App Package - Reduce Explicit Any (PR #3)
High-priority files with explicit `any`:
- [ ] `lib/interfaces/` - Define proper types
- [ ] `lib/services/` - Type service responses
- [ ] `lib/hooks/` - Type hook returns
- [ ] `components/` - Type component props/callbacks

### 3.5 Infrastructure Package - Reduce Explicit Any (PR #4)
High-priority Lambda files:
- [ ] `lambda/helpers/` - Type helper functions
- [ ] `lambda/brief/` - Type brief handlers
- [ ] `lambda/proposal/` - Type proposal handlers
- [ ] `lambda/samgov/` - Type SAM.gov handlers

### 3.6 ESLint Configuration (PR #5)
- [ ] Add `@typescript-eslint/no-explicit-any` rule (warn initially)
- [ ] Add `@typescript-eslint/explicit-function-return-type` rule
- [ ] Add `@typescript-eslint/strict-boolean-expressions` rule
- [ ] Gradually increase strictness to error level

---

## 4. Additional Quality Improvements
**Priority:** Medium | **Effort:** Medium

### 4.1 Code Quality
- [ ] Add pre-commit hooks with husky
- [ ] Configure lint-staged for staged file linting
- [ ] Add commitlint for conventional commits

### 4.2 Test Coverage
- [ ] Set up coverage thresholds (target: 70%+)
- [ ] Add coverage reporting to CI
- [ ] Identify and add tests for uncovered critical paths

### 4.3 Security
- [ ] Add npm audit to CI pipeline
- [ ] Configure Dependabot for dependency updates
- [ ] Add SAST scanning (e.g., CodeQL)

---

## Progress Tracking

| Task | Status | PR | Date |
|------|--------|-----|------|
| Testing Infrastructure | Completed | #22 | 2025-01-19 |
| Update CLAUDE.md | Not Started | - | - |
| Lighthouse Setup | Not Started | - | - |
| TS Strict - Infrastructure | Not Started | - | - |
| TS Strict - Web-App Fix Implicit | Not Started | - | - |
| TS Strict - Web-App Reduce Any | Not Started | - | - |
| TS Strict - Infrastructure Reduce Any | Not Started | - | - |
| ESLint Configuration | Not Started | - | - |

---

## Notes

### Build Order Dependency
The `@auto-rfp/shared` module must be built before type-checking other packages:
```bash
cd shared && pnpm build
cd ../web-app && pnpm tsc --noEmit
cd ../infrastructure && npx tsc --noEmit
```

### Recommended PR Sequence
1. CLAUDE.md updates (documentation)
2. Lighthouse accessibility setup (independent)
3. Infrastructure strict TypeScript (foundation)
4. Web-app implicit any fixes (highest impact)
5. ESLint configuration (enforcement)
6. Remaining any type reductions (incremental)
