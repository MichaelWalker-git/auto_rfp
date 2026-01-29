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

## CI Status

| Workflow | Status | Notes |
|----------|--------|-------|
| Deploy Infrastructure | Passing | All 8 CDK stacks deployed |
| E2E Tests | Passing | Playwright tests running |
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
| `auth.spec.ts` | 3 | Partial | Auth redirect, login form (1 skipped) |
| `organization.spec.ts` | 5 | Skipped | Requires auth setup |
| `visual.spec.ts` | ? | Active | Visual regression tests |

### Missing E2E Coverage (Prioritized)

#### High Priority - Core Flows
- [ ] **Document Upload Pipeline** - Upload documents to knowledge base, verify processing
- [ ] **Question Extraction** - Upload RFP, extract questions, verify in UI
- [ ] **Answer Generation** - Generate answers with RAG, verify source citations
- [ ] **Proposal Generation** - Generate proposal from Q&A, export to PDF/DOCX

#### Medium Priority - Business Features
- [ ] **Executive Brief Generation** - Generate brief, verify all 6 sections
- [ ] **SAM.gov Search** - Search opportunities, import into project
- [ ] **Knowledge Base CRUD** - Create, update, delete knowledge bases
- [ ] **Project CRUD** - Create, update, delete projects (need auth fixture)

#### Lower Priority - Admin/Settings
- [ ] **User Profile Management** - Update user settings
- [ ] **Organization Settings** - Manage org settings, member invites
- [ ] **Custom Prompts** - Create and manage custom prompts

### Recommended Next Steps for E2E

1. **Set up authenticated test fixtures**
   - Create test user in Cognito
   - Implement Playwright storage state for auth persistence
   - Enable skipped organization/project tests

2. **Add document upload tests**
   - Mock S3 presigned URL responses
   - Test file upload component
   - Verify pipeline status polling

3. **Add question extraction tests**
   - Upload test RFP document
   - Verify questions appear in UI
   - Test section grouping

4. **Add answer generation tests**
   - Test answer modal/drawer
   - Verify RAG source citations
   - Test answer editing and saving
