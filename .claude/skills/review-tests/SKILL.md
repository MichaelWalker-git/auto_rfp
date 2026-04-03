---
name: review-tests
description: Test coverage review - verify all new functions have tests, edge cases are covered, mocks are correct
---

# Test Coverage Review

Assess test coverage for changed code and identify gaps.

## Process

1. Get changed files: `git diff develop...HEAD --name-only`
2. For each changed source file, check if a corresponding `.test.ts` exists
3. For each test file, verify coverage depth

### Coverage Checklist per Function

For every new or modified exported function:
- [ ] Happy path test exists
- [ ] Empty/null input test exists
- [ ] Malformed input test exists
- [ ] Error path test exists (what if dependencies throw?)
- [ ] Boundary conditions tested (first/last item, max length, zero)

### Mock Correctness
- Do mocks match the actual module interface?
- Are mock return values realistic (matching actual API shapes)?
- Are mocks reset in `beforeEach`?
- Are mocks declared before imports (Jest hoisting)?

### Test Quality
- Are assertions specific (not just `toBeDefined` or `toBeTruthy`)?
- Do tests verify behavior, not implementation details?
- Are test descriptions clear about what's being tested?
- Are there tests for the interaction between modules (not just unit isolation)?

### Missing Test Categories
Identify which categories of tests are missing:

| Category | Description |
|---|---|
| Unit tests | Individual function behavior |
| Integration tests | Multi-module interaction (e.g., handler → helper → DB) |
| Edge case tests | Empty input, special characters, boundary values |
| Regression tests | Tests that would catch previously reported bugs |
| Format-specific tests | If feature spans PDF/DOCX/HTML, each format tested? |

## Output

```
## Test Coverage Report

### Files Without Tests
- `path/to/file.ts` — [N exported functions, 0 tests]

### Files With Incomplete Tests
- `path/to/file.test.ts`
  - Covered: [list of tested functions]
  - Missing: [list of untested functions/paths]
  - Missing edge cases: [specific inputs not tested]

### Mock Issues
- [description of incorrect or incomplete mocks]

### Recommended New Tests
1. `path/to/new-test.test.ts` — [what to test]
2. Add to `path/to/existing.test.ts` — [specific test cases]
```