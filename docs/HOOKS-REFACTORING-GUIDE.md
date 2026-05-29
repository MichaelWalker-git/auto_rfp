# Web App Hooks Refactoring Guide

**Date**: February 16, 2026  
**Status**: In Progress

## Overview

This document describes the standardized patterns for React hooks in `web-app/lib/hooks/` and lists all hooks that need refactoring.

## Completed

- [x] `api-helpers.ts` — New shared utilities (`ApiError`, `apiFetcher`, `apiMutate`, `useApi`, `buildApiUrl`)
- [x] `use-api.ts` — Refactored to use `api-helpers.ts`, removed duplicate `HttpError` and `defineFetcher`
- [x] `use-get-api-key.ts` — Replaced duplicate `HttpError`/`defineFetcher` with `useApi`/`ApiError`
- [x] `use-set-api-key.ts` — Replaced duplicate `HttpError` with `apiMutate`/`ApiError`
- [x] `use-google-api-key.ts` — Replaced duplicate `HttpError`/`defineFetcher` with `useApi`/`apiMutate`
- [x] `use-linear-api-key.ts` — Standardized with `useApi`/`apiMutate`
- [x] `use-get-organization-by-id.ts` — Replaced raw `fetchAuthSession`+`fetch` with `apiFetcher`
- [x] `use-knowledgebase.ts` — Replaced local `fetcher`, URL-as-key with `useApi`/`apiMutate`
- [x] `use-document.ts` — Replaced local `fetcher`, URL-as-key with `useApi`/`apiMutate`
- [x] `use-project.ts` — Removed duplicate `useProject`, standardized `useDeleteProject`
- [x] `use-answer.ts` — Replaced local error handling with `apiMutate`
- [x] `use-user.ts` — Replaced local `assertOk`/`listFetcher`/`buildQueryString` with `useApi`/`apiMutate`/`buildApiUrl`
- [x] `use-content-library.ts` — Replaced local `fetcher`/`mutationFetcher`, removed `console.log`, standardized all hooks
- [x] `use-create-organization.ts` — Replaced manual fetch with `apiMutate`
- [x] `use-delete-organization.ts` — Replaced manual fetch with `apiMutate`
- [x] `use-create-project.ts` — Replaced manual fetch with `apiMutate`
- [x] `use-update-project.ts` — Replaced manual fetch with `apiMutate`, **fixed URL bug** (trailing `}`)

## Standardized Patterns

### Pattern 1: GET Hook (Read Data)

Use `useApi<T>()` from `api-helpers.ts`:

```typescript
import { useApi, buildApiUrl } from './api-helpers';
import { KnowledgeBase } from '@auto-rfp/shared';

export function useKnowledgeBases(orgId: string | null) {
  return useApi<KnowledgeBase[]>(
    orgId ? ['knowledgebases', orgId] : null,
    orgId ? buildApiUrl('knowledgebase/get-knowledgebases', { orgId }) : null,
    { revalidateIfStale: true },  // optional SWR config overrides
  );
}
```

**Rules:**
- SWR key MUST be an array (not a URL string) for proper cache management
- Use `buildApiUrl()` for URL construction
- Return type should use types from `@auto-rfp/shared` when available
- Pass `null` key when params are missing (disables fetching)

### Pattern 2: Mutation Hook (Create/Update/Delete)

Use `useSWRMutation` with `apiMutate()`:

```typescript
import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl, ApiError } from './api-helpers';
import { KnowledgeBase } from '@auto-rfp/shared';

export function useCreateKnowledgeBase(orgId: string) {
  return useSWRMutation<KnowledgeBase, ApiError, string, Partial<KnowledgeBase>>(
    buildApiUrl('knowledgebase/create-knowledgebase', { orgId }),
    async (url, { arg }) => apiMutate<KnowledgeBase>(url, 'POST', arg),
  );
}

export function useDeleteKnowledgeBase() {
  return useSWRMutation<unknown, ApiError, string, KnowledgeBase>(
    buildApiUrl('knowledgebase/delete-knowledgebase'),
    async (url, { arg }) => apiMutate(url, 'DELETE', arg),
  );
}
```

**Rules:**
- Use `apiMutate()` for the actual HTTP call
- Use `ApiError` as the error type
- Keep the hook thin — no business logic

### Pattern 3: Simple Action Hook (No SWR)

For one-off actions that don't need SWR caching:

```typescript
import { apiMutate, buildApiUrl } from './api-helpers';
import { Organization } from '@/types/organization';

export function useCreateOrganization() {
  const createOrganization = async (payload: { name: string; description: string }): Promise<Organization> => {
    return apiMutate<Organization>(
      buildApiUrl('organization/create-organization'),
      'POST',
      payload,
    );
  };

  return { createOrganization };
}
```

### Anti-Patterns to Avoid

| ❌ Don't | ✅ Do |
|----------|-------|
| Define `HttpError` class in each hook file | Import `ApiError` from `api-helpers` |
| Define `defineFetcher` / `fetcher` in each file | Import `apiFetcher` from `api-helpers` |
| Use raw `fetchAuthSession` + `fetch` | Use `authFetcher` via `apiFetcher` or `apiMutate` |
| Use URL string as SWR key | Use array keys: `['entity', id]` |
| Define response types in hook files | Define in `@auto-rfp/shared` or `@/types/` |
| Add `console.log` for debugging | Remove before committing |
| Mix domain hooks in `use-api.ts` | Keep domain hooks in their own files |

---

## Hooks Refactoring Checklist

### Priority 1: High-Impact (Duplicate Code)

| Hook File | Issues | Action |
|-----------|--------|--------|
| `use-get-api-key.ts` | Duplicate `HttpError`, `defineFetcher` | Replace with `useApi` + `ApiError` from `api-helpers` |
| `use-set-api-key.ts` | Duplicate `HttpError` | Replace with `apiMutate` + `ApiError` |
| `use-google-api-key.ts` | Duplicate `HttpError`, `defineFetcher` | Replace with `useApi` + `useSWRMutation` + `apiMutate` |
| `use-linear-api-key.ts` | Inconsistent fetcher pattern | Replace with `useApi` + `useSWRMutation` + `apiMutate` |
| `use-get-organization-by-id.ts` | Uses raw `fetchAuthSession` + `fetch` instead of `authFetcher` | Replace with `apiMutate` or `apiFetcher` |

### Priority 2: Standardize Patterns

| Hook File | Issues | Action |
|-----------|--------|--------|
| `use-knowledgebase.ts` | Local `fetcher`, URL as SWR key | Use `useApi` for GETs, `useSWRMutation` + `apiMutate` for mutations |
| `use-document.ts` | Local `fetcher`, URL as SWR key | Same as above |
| `use-content-library.ts` | 200+ lines of types (should be in shared), `console.log`, local `fetcher`/`mutationFetcher` | Move types to `@auto-rfp/shared`, use `useApi`/`apiMutate`, remove console.log |
| `use-user.ts` | Local `assertOk`, `listFetcher`, `buildQueryString` | Use `apiFetcher`, `apiMutate`, `buildApiUrl` |
| `use-project.ts` | URL as SWR key, duplicate of `useProject` in `use-api.ts` | Remove duplicate, use `useApi` pattern |
| `use-answer.ts` | Local error handling pattern | Use `apiMutate` |

### Priority 3: Minor Cleanup

| Hook File | Issues | Action |
|-----------|--------|--------|
| `use-create-organization.ts` | Manual fetch + error handling | Use `apiMutate` |
| `use-delete-organization.ts` | Manual fetch + error handling | Use `apiMutate` |
| `use-create-project.ts` | Manual fetch + error handling | Use `apiMutate` |
| `use-update-project.ts` | Manual fetch + error handling, trailing `}` in URL | Use `apiMutate`, fix URL bug |
| `use-presign.ts` | Uses raw `fetchAuthSession` + `fetch` | Use `authFetcher` via `apiMutate` |
| `use-organizations.ts` | Empty file | Already annotated with TODO |

### Priority 4: Review Only (Already Reasonable)

| Hook File | Status |
|-----------|--------|
| `use-deadlines.ts` | Review for pattern consistency |
| `use-debriefing.ts` | Review for pattern consistency |
| `use-executive-brief.ts` | Review for pattern consistency |
| `use-extract-questions.ts` | Review for pattern consistency |
| `use-file.ts` | Review for pattern consistency |
| `use-foia-requests.ts` | Review for pattern consistency |
| `use-icon-url.ts` | Review for pattern consistency |
| `use-import-solicitation.ts` | Review for pattern consistency |
| `use-opportunities.ts` | Review for pattern consistency |
| `use-past-performance.ts` | Review for pattern consistency |
| `use-profile.ts` | Review for pattern consistency |
| `use-project-outcome.ts` | Review for pattern consistency |
| `use-prompt.ts` | Review for pattern consistency |
| `use-proposal.ts` | Review for pattern consistency |
| `use-question-file.ts` | Review for pattern consistency |
| `use-rfp-documents.ts` | Review for pattern consistency |
| `use-saved-search.ts` | Review for pattern consistency |
| `use-sentry-context.ts` | Non-API hook, skip |
| `use-set-project-outcome.ts` | Review for pattern consistency |
| `use-templates.ts` | Review for pattern consistency |
| `use-textract.ts` | Review for pattern consistency |
| `use-user-resolver.ts` | Review for pattern consistency |

---

## Bug Found During Audit

**File**: `use-update-project.ts`  
**Line**: URL construction has a trailing `}`:
```typescript
const url = `${base}/projects/update/${payload.projectId}?orgId=${payload.orgId}}`;
//                                                                              ^ extra }
```
This should be:
```typescript
const url = buildApiUrl(`projects/update/${payload.projectId}`, { orgId: payload.orgId });
```

---

## Migration Strategy

1. **Phase 1** (Done): Create `api-helpers.ts` and refactor `use-api.ts`
2. **Phase 2**: Refactor Priority 1 hooks (duplicate code elimination)
3. **Phase 3**: Refactor Priority 2 hooks (pattern standardization)
4. **Phase 4**: Refactor Priority 3 hooks (minor cleanup)
5. **Phase 5**: Review Priority 4 hooks

Each phase should be a separate PR to minimize risk. Run the full test suite after each phase.
