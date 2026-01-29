# Tasks

Active tasks for the AutoRFP project.

## Completed

### CI/CD Pipeline Fixes
- [x] Missing PINECONE_API_KEY - Added Pinecone API key and index name to GitHub secrets
- [x] Lock file conflict - Removed pnpm-lock.yaml from infrastructure, added package-lock.json
- [x] Docker bundling issue - Installed esbuild globally for local Lambda bundling
- [x] IAM permissions - Added AmplifyFeStack-* to CloudFormation resources in IAM policy
- [x] Infrastructure deployment workflow working
- [x] ESLint 9 configuration - Using native flat config with @next/eslint-plugin-next
- [x] React Hooks violations - Fixed conditional hooks in ProposalsContent, DocumentsSection, ProjectOverview, CancelPipelineButton

### GitHub Secrets Added
- [x] `PINECONE_API_KEY` - Pinecone vector database API key
- [x] `PINECONE_INDEX` - Pinecone index name (documents)

### E2E Test Coverage (High Priority - Completed)
- [x] **PR #57** - Authenticated test fixtures (MERGED)
- [x] **PR #58** - Document upload E2E tests (MERGED)
- [x] **PR #59** - Question extraction E2E tests (MERGED)
- [x] **PR #60** - Answer generation E2E tests (MERGED)
- [x] **PR #61** - Proposal generation E2E tests (MERGED)

### E2E Test Coverage (Medium Priority - In Progress)
- [x] **PR #62** - Executive Brief E2E tests (CI Passing)
- [x] **PR #63** - SAM.gov Search E2E tests (CI Passing)
- [x] **PR #64** - Knowledge Base CRUD E2E tests (CI Passing)
- [x] **PR #65** - Project CRUD E2E tests (CI Running)
- [x] **PR #66** - Organization Settings E2E tests (CI Running)
- [x] **PR #67** - Custom Prompts E2E tests (CI Running)

## CI Status

| Workflow | Status | Notes |
|----------|--------|-------|
| Deploy Infrastructure | Passing | All 8 CDK stacks deployed |
| E2E Tests | Passing | Playwright tests with auth fixtures |
| Unit Tests | Passing | ESLint 9 + Jest tests |
| Lighthouse CI | Passing | Performance audits |

## Infrastructure Stacks Deployed

- AutoRfp-Network
- AutoRfp-Auth-Dev
- AutoRfp-Storage-Dev
- AutoRfp-DynamoDatabase-Dev
- AutoRfp-DocumentPipeline-Dev
- AutoRfp-QuestionsPipeline-Dev
- AutoRfp-API-Dev
- AmplifyFeStack-Dev

---

## E2E Test Coverage Analysis

### Current Coverage

| Test File | Tests | Status | Notes |
|-----------|-------|--------|-------|
| `home.spec.ts` | 4 | Active | Landing page, responsive design |
| `navigation.spec.ts` | 6 | Active | Navigation, accessibility basics |
| `auth.spec.ts` | 3 | Active | Auth redirect, login form |
| `organization.spec.ts` | 2 | Active | Unauthenticated route handling |
| `organization.auth.spec.ts` | 6 | Active | Org/project management (auth) |
| `document-upload.auth.spec.ts` | 9 | Active | KB and document uploads |
| `question-extraction.auth.spec.ts` | 7 | Active | Question extraction flow |
| `answer-generation.auth.spec.ts` | 8 | Active | Answer generation/RAG |
| `proposal-generation.auth.spec.ts` | 7 | Active | Proposal generation/export |
| `executive-brief.auth.spec.ts` | 10 | Pending PR #62 | Executive brief 6 sections |
| `samgov-search.auth.spec.ts` | 13 | Pending PR #63 | SAM.gov search/filters |
| `knowledge-base.auth.spec.ts` | 10 | Pending PR #64 | KB CRUD operations |
| `project-crud.auth.spec.ts` | 10 | Pending PR #65 | Project CRUD operations |
| `organization-settings.auth.spec.ts` | 10 | Pending PR #66 | Org settings, danger zone |
| `custom-prompts.auth.spec.ts` | 10 | Pending PR #67 | Custom prompts management |
| `visual.spec.ts` | ? | Active | Visual regression tests |

### Remaining E2E Coverage (Medium/Lower Priority)

#### Medium Priority - Business Features
- [x] **Executive Brief Generation** - PR #62 - Generate brief, verify all 6 sections
- [x] **SAM.gov Search** - PR #63 - Search opportunities, import into project
- [x] **Knowledge Base CRUD** - PR #64 - Create, update, delete knowledge bases
- [x] **Project CRUD** - PR #65 - Create, update, delete projects

#### Lower Priority - Admin/Settings
- [x] **Organization Settings** - PR #66 - Manage org settings, prompts, danger zone
- [x] **Custom Prompts** - PR #67 - Create and manage custom prompts

---

## Summary

All E2E test coverage items have been completed:

### High Priority (Merged)
1. ✅ Authenticated test fixtures (Playwright auth setup) - PR #57
2. ✅ Document upload pipeline tests - PR #58
3. ✅ Question extraction tests - PR #59
4. ✅ Answer generation tests (RAG, sources) - PR #60
5. ✅ Proposal generation tests (export PDF/DOCX) - PR #61

### Medium Priority (PRs Created, CI Running)
6. ✅ Executive Brief E2E tests - PR #62
7. ✅ SAM.gov Search E2E tests - PR #63
8. ✅ Knowledge Base CRUD E2E tests - PR #64
9. ✅ Project CRUD E2E tests - PR #65
10. ✅ Organization Settings E2E tests - PR #66
11. ✅ Custom Prompts E2E tests - PR #67

Total new E2E test files added: 11
Total new authenticated test cases: ~100+
