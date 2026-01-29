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

### E2E Test Infrastructure
- [x] **PR #57** - Authenticated test fixtures (MERGED)
  - Playwright setup/teardown projects
  - Global auth setup with Cognito
  - organization.auth.spec.ts for authenticated tests

## In Progress

### E2E Test Coverage
- [ ] **PR #58** - Document upload E2E tests (In Review)
  - KB list navigation
  - Upload zone visibility
  - Project documents section
  - Question extraction dialog

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
| `document-upload.auth.spec.ts` | 9 | PR #58 | KB and document uploads |
| `visual.spec.ts` | ? | Active | Visual regression tests |

### Remaining E2E Coverage (Prioritized)

#### High Priority - Core Flows
- [x] **Authenticated test fixtures** - PR #57 merged
- [x] **Document Upload Pipeline** - PR #58 in review
- [ ] **Question Extraction** - Upload RFP, extract questions, verify in UI
- [ ] **Answer Generation** - Generate answers with RAG, verify source citations
- [ ] **Proposal Generation** - Generate proposal from Q&A, export to PDF/DOCX

#### Medium Priority - Business Features
- [ ] **Executive Brief Generation** - Generate brief, verify all 6 sections
- [ ] **SAM.gov Search** - Search opportunities, import into project
- [ ] **Knowledge Base CRUD** - Create, update, delete knowledge bases
- [ ] **Project CRUD** - Create, update, delete projects

#### Lower Priority - Admin/Settings
- [ ] **User Profile Management** - Update user settings
- [ ] **Organization Settings** - Manage org settings, member invites
- [ ] **Custom Prompts** - Create and manage custom prompts
