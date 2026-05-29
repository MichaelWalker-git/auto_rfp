# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AutoRFP** is an enterprise-grade AI-powered RFP (Request for Proposals) response automation platform. It helps government contractors and enterprises:
- Process RFP documents and extract questions automatically
- Generate AI-powered answers using RAG (Retrieval Augmented Generation)
- Create executive opportunity briefs with GO/NO-GO recommendations
- Manage knowledge bases of past performance documents
- Search SAM.gov for government contract opportunities
- Generate and export professional proposals

## Monorepo Structure

```
auto_rfp/
├── web-app/           # Next.js 16 frontend (React 18, Tailwind, Shadcn UI)
├── infrastructure/    # AWS CDK infrastructure & Lambda functions
├── shared/            # Shared TypeScript types and Zod schemas
├── amplify.yml        # AWS Amplify build configuration
└── local-docs/        # Development documentation
```

## Common Commands

### Web App (`web-app/` directory)
```bash
pnpm dev              # Start development server (port 3000)
pnpm build            # Production build
pnpm lint             # Run ESLint
pnpm test             # Run Jest tests
pnpm test:watch       # Run tests in watch mode
pnpm test:e2e         # Run Playwright e2e tests
```

### Shared Package (`shared/` directory)
```bash
pnpm build            # Build shared types with tsup (required before web-app)
pnpm test             # Run schema unit tests
```

### Infrastructure (`infrastructure/` directory)
```bash
npm run build         # Compile TypeScript
npm run deploy        # Deploy CDK stack (uses --profile michael-primary)
npm run destroy       # Destroy CDK stack
npm run diff          # Show CDK diff
npm run synth         # Synthesize CloudFormation template
npm run test          # Run Jest tests for Lambda functions
```

### Full Build Order
```bash
cd shared && pnpm build
cd ../web-app && pnpm build
cd ../infrastructure && npm run deploy
```

## AWS Profile

All AWS CLI and CDK commands use the **`michael-primary`** profile:
```bash
--profile michael-primary
```

> **Note for Developers**: The `michael-primary` profile is used in this documentation for demonstration purposes. Replace it with your own AWS profile name (e.g., `default`, `dev`, or your organization's profile) when running commands. Configure your AWS profile using `aws configure --profile <your-profile-name>` or set up profiles in `~/.aws/config`.

Update infrastructure commands if needed:
```bash
cdk deploy --profile michael-primary --require-approval never
```

## Git Branching Strategy

```
Feature Branches ──► develop ──► Amplify Staging (QA/Testing)
                          │
                          └──► production ──► Amplify Production (CUSTOMERS)
                                    ▲
                                    │
                              Release Workflow
                              (manual trigger)
```

**Branches:**
- **develop** - Active development branch. PRs merge here first. Deploys to **staging** environment for QA.
- **production** - Stable, customer-facing code. Only updated via Release workflow. Deploys to **production** environment.

**Environments:**
- **Staging** (develop branch): `https://develop.d1xxxxxx.amplifyapp.com` - For testing before release
- **Production** (production branch): `https://production.d1xxxxxx.amplifyapp.com` - Customer-facing

**Workflow:**
1. Create feature branches from `develop`
2. Open PRs targeting `develop`
3. After PR approval and CI passes, merge to `develop`
4. **Test on staging environment** - Verify changes work correctly
5. When ready to release, run the **Release to Production** workflow (Actions → Release to Production → Run workflow)
6. Verify on production environment

**Branch Protection Rules:**
- Both `develop` and `production` require:
  - Pull request reviews (1 approval required)
  - No direct pushes (must use PRs)
  - No force pushes
  - No branch deletion

## CI/CD Workflows

### Automated Testing (on every PR)
- **Unit Tests** (`unit-tests.yml`): Runs shared, web-app, and infrastructure tests
- **E2E Tests** (`e2e-tests.yml`): Runs Playwright end-to-end tests
- **Lighthouse** (`lighthouse.yml`): Performance audits

### Release Process
To release to production:
```bash
# Via GitHub Actions UI:
# 1. Go to Actions → "Release to Production"
# 2. Click "Run workflow"
# 3. Enter version (e.g., v1.2.0) and description
# 4. Click "Run workflow"
```

The release workflow will:
1. Validate there are commits to release
2. Run all tests on develop
3. Merge develop into production
4. Create a Git tag and GitHub Release

## Architecture Overview

### Frontend (web-app)

**Stack**: Next.js 16, React 18, Tailwind CSS 4, Shadcn UI

**Key Directories**:
- `app/` - Next.js App Router pages
- `components/` - React components (UI in `components/ui/`)
- `lib/hooks/` - SWR-based data fetching hooks
- `lib/services/` - Business logic services
- `context/` - React context providers
- `providers/` - Auth, Theme, Organization providers

**State Management**:
- Server state: SWR with automatic revalidation
- URL state: `nuqs` library
- Auth state: AWS Amplify + React Context
- Minimal client-side state

**Auth Flow**:
1. AWS Cognito via Amplify Authenticator
2. JWT with custom claims: `custom:orgId`, `custom:role`
3. Role-based permissions (Owner, Admin, Editor, Viewer, Member)

### Backend (infrastructure/lambda)

**Stack**: AWS Lambda (Node.js 20), API Gateway, DynamoDB, OpenSearch, Step Functions

**Lambda Organization** (`infrastructure/lambda/`):
```
lambda/
├── organization/      # Org CRUD operations
├── project/           # Project management
├── document/          # Document CRUD & indexing
├── knowledgebase/     # Knowledge base management
├── answer/            # Answer generation with RAG
├── question/          # Question extraction
├── question-file/     # Question file processing
├── question-pipeline/ # Step Function handlers
├── proposal/          # Proposal generation
├── brief/             # Executive brief generation (6 sections)
├── samgov/            # SAM.gov API integration
├── semantic/          # Semantic search
├── presigned/         # S3 presigned URLs
├── user/              # User management
├── prompt/            # Custom prompt management
├── deadlines/         # Deadline extraction
├── helpers/           # Shared utilities
├── constants/         # Configuration constants
└── schemas/           # Zod validation schemas
```

**Key AWS Services**:
- **DynamoDB**: Single-table design for all entities
- **OpenSearch Serverless**: Vector search with Titan embeddings
- **S3**: Document storage with presigned upload/download
- **Step Functions**: Document & question processing pipelines
- **SQS**: Executive brief async job queue
- **Textract**: PDF/document text extraction
- **Bedrock**: Claude 3 (answers, briefs) + Titan (embeddings)
- **Cognito**: User authentication
- **API Gateway**: REST API with Cognito authorizer

### Shared Package (shared/src/schemas)

**Zod Schemas** for type-safe API contracts:
- `user.ts` - User, roles, permissions
- `project.ts` - Project CRUD
- `document.ts` - Knowledge base documents
- `question.ts` - RFP questions
- `answer.ts` - AI-generated answers with sources
- `proposal.ts` - Proposal documents with sections
- `executive-opportunity-brief.ts` - 6-section brief structure
- `samgov.ts` - SAM.gov API types
- `kb.ts` - Knowledge base management
- `prompt.ts` - Custom prompts per org

## Core Features

### 1. Document Processing Pipeline
```
Upload → S3 → Step Function → Textract → Chunking → Titan Embeddings → Pinecone Index
```
- Supports: PDF, DOCX, XLSX, PPTX
- Chunk size: 2,500 chars with 250-char overlap
- Status tracking: UPLOADED → PROCESSING → INDEXED

### 2. Question Extraction
```
Question File → Textract → Claude Analysis → Structured Questions → DynamoDB
```
- AI extracts questions from RFP documents
- Groups questions by section
- Stores with metadata for answer generation

### 3. Answer Generation (RAG)
```
Question → Titan Embed → OpenSearch KNN → Top-K Chunks → Claude + Context → Answer
```
- Semantic search over indexed documents
- Source attribution with confidence scores
- Answer caching and reuse

### 4. Executive Brief Generation
6 async sections via SQS worker:
1. **Summary** - Opportunity overview
2. **Deadlines** - Key dates extraction
3. **Requirements** - Technical/compliance requirements
4. **Contacts** - Point of contact information
5. **Risks** - Red flags and risk assessment
6. **Scoring** - GO/NO-GO recommendation (waits for other sections)

### 5. Proposal Generation
- Combines Q&A pairs with knowledge base context
- Generates structured proposal with sections/subsections
- Export: PDF, DOCX, XLSX

### 6. SAM.gov Integration
- Search government contract opportunities
- Import solicitations into projects
- Saved searches with scheduled execution

## Key Patterns

### TypeScript/React (from .cursor/rules)
- Functional components with TypeScript interfaces
- Prefer `interface` over `type`
- Use `const` maps instead of enums
- Use `satisfies` operator for type validation
- Prefix handlers with `handle` (handleClick, handleSubmit)
- Descriptive names with auxiliary verbs (isLoading, hasError)

### Next.js 16 Async Patterns
```typescript
// Always await runtime APIs
const cookieStore = await cookies()
const headersList = await headers()
const params = await props.params
const searchParams = await props.searchParams

// Use useActionState (not useFormState)
const [state, action] = useActionState(submitForm, initialState)
```

### Lambda Handler Pattern
```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { z } from 'zod';
import { apiResponse, parseBody } from '../helpers/api';

const RequestSchema = z.object({
  name: z.string().min(1),
  orgId: z.string().uuid(),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const body = parseBody(event);
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return apiResponse(400, { error: parsed.error.format() });
  }

  // Business logic with parsed.data
  return apiResponse(200, { data: result });
};
```

### SWR Data Fetching Pattern
```typescript
// lib/hooks/use-projects.ts
export function useProjects(orgId: string) {
  const { data, error, isLoading, mutate } = useSWR(
    orgId ? `/api/projects/l?orgId=${orgId}` : null,
    fetcher
  );
  return { projects: data?.data, error, isLoading, mutate };
}
```

## Database Schema (DynamoDB Single-Table)

**Key Structure**:
```
PK: ORG#{orgId} | PROJECT#{orgId}#{projectId} | DOCUMENT#{kbId}#{docId} | ...
SK: Composite key for efficient queries

Examples:
- ORG#uuid-123
- ORG#uuid-123#USER#uuid-456
- PROJECT#uuid-123#uuid-789
- DOCUMENT#KB#kb-uuid#DOC#doc-uuid
- QUESTION#proj-uuid#q-uuid
- EXEC_BRIEF#brief-uuid
```

## Environment Variables

### Web App (`.env.local`)
```bash
NEXT_PUBLIC_API_BASE_URL=<API Gateway URL>
NEXT_PUBLIC_COGNITO_USER_POOL_ID=<from CDK output>
NEXT_PUBLIC_COGNITO_CLIENT_ID=<from CDK output>
NEXT_PUBLIC_COGNITO_REGION=us-east-1
```

### Infrastructure Deployment
```bash
export SAM_GOV_API_KEY="your-sam-gov-api-key"  # Required for deploy
```

### Lambda Environment (set via CDK)
```
DB_TABLE_NAME, DOCUMENTS_BUCKET, OPENSEARCH_ENDPOINT, OPENSEARCH_INDEX
BEDROCK_MODEL_ID, BEDROCK_EMBEDDING_MODEL_ID, BEDROCK_REGION
COGNITO_USER_POOL_ID, STATE_MACHINE_ARN, EXEC_BRIEF_QUEUE_URL
SENTRY_DSN, LINEAR_API_KEY_SECRET_ARN
```

## Testing

### Unit Tests (Jest)
```bash
# Shared schemas
cd shared && pnpm test

# Lambda functions
cd infrastructure && npm test

# Web app components
cd web-app && pnpm test
```

### Component Tests (React Testing Library)
```bash
cd web-app && pnpm test:components
```

### E2E Tests (Playwright)
```bash
cd web-app && pnpm test:e2e
cd web-app && pnpm test:e2e:ui  # With Playwright UI
```

### Test File Naming
- Unit tests: `*.test.ts` or `*.spec.ts`
- Component tests: `*.test.tsx`
- E2E tests: `e2e/*.spec.ts`

## API Endpoints Reference

### Organization
- `GET /organization/get-organizations` - List user's orgs
- `POST /organization/create-organization` - Create org
- `GET /organization/get-organization/{id}` - Get org by ID
- `PATCH /organization/edit-organization/{id}` - Update org
- `DELETE /organization/delete-organization` - Delete org

### Project
- `GET /project/get-projects` - List projects
- `POST /project/create-project` - Create project
- `GET /project/get-project/{id}` - Get project
- `DELETE /project/delete-project` - Delete project
- `GET /project/get-questions/{id}` - Get project questions

### Document
- `POST /document/create-document` - Create document record
- `POST /document/start-document-pipeline` - Start processing
- `GET /document/get-documents` - List documents
- `GET /document/get-document` - Get document
- `DELETE /document/delete-document` - Delete document

### Answer
- `POST /answer/generate-answer` - Generate AI answer
- `POST /answer/save-answer` - Save answer
- `GET /answer/get-answers/{id}` - Get answers for question

### Brief
- `POST /brief/init-executive-brief` - Start brief generation
- `POST /brief/generate-executive-brief-*` - Generate specific section
- `GET /brief/get-executive-brief-by-project` - Get brief

### Proposal
- `POST /proposal/generate-proposal` - Generate proposal
- `POST /proposal/save-proposal` - Save proposal
- `GET /proposal/get-proposals` - List proposals
- `GET /proposal/get-proposal` - Get proposal

## Troubleshooting

### Build Issues
```bash
# Clear Next.js cache
rm -rf web-app/.next

# Rebuild shared package
cd shared && pnpm build

# Check for TypeScript errors
cd web-app && pnpm tsc --noEmit
```

### AWS Deployment Issues
```bash
# Verify AWS credentials
aws sts get-caller-identity --profile michael-primary

# Check CDK bootstrap
cdk bootstrap --profile michael-primary

# View CloudFormation events
aws cloudformation describe-stack-events --stack-name AutoRfpApiStack --profile michael-primary
```

### Database Issues
```bash
# Scan DynamoDB table
aws dynamodb scan --table-name auto-rfp-main --profile michael-primary --max-items 10
```

---

## Code Quality Standards

### TypeScript Strictness Requirements

All packages use `strict: true`. Additional requirements:

**DO NOT use `any` type unless absolutely necessary.** When you must:
1. Add a `// TODO: Type this properly` comment
2. Create a ticket for future type improvement
3. Use `unknown` with type guards when possible

**Callback Parameter Typing:**
```typescript
// BAD - implicit any
items.map((item, index) => ...)
items.filter((x) => ...)

// GOOD - explicit types
items.map((item: Item, index: number) => ...)
items.filter((x: Item) => ...)
```

**Type Assertions:**
```typescript
// BAD - casting to any
const data = response as any;

// GOOD - proper typing or unknown
const data = response as ApiResponse;
// OR
const data: unknown = response;
if (isApiResponse(data)) { ... }
```

### Test Patterns

**Unit Tests (Jest/Vitest):**
```typescript
describe('ComponentName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should [expected behavior] when [condition]', () => {
    // Arrange
    const input = {...};

    // Act
    const result = functionUnderTest(input);

    // Assert
    expect(result).toBe(expected);
  });
});
```

**Mock AWS SDK:**
```typescript
// Mock before imports
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: jest.fn(),
}));

// Mock credential provider for signature operations
jest.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: jest.fn(() => () =>
    Promise.resolve({
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    })
  ),
}));
```

**Mock ESM Modules (e.g., uuid):**
```typescript
// Must mock BEFORE importing module that uses it
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

import { handler } from './my-handler';
```

### Accessibility Standards

Target WCAG 2.1 AA compliance:

**Component Requirements:**
- All interactive elements must be keyboard accessible
- Color contrast ratio: 4.5:1 for normal text, 3:1 for large text
- All images must have meaningful alt text
- Form inputs must have associated labels
- Focus indicators must be visible

**Accessibility Testing:**
```bash
# Run Lighthouse accessibility audit
cd web-app && pnpm lighthouse

# Run axe-core tests
cd web-app && pnpm test:a11y
```

**Common Fixes:**
```tsx
// BAD - no accessible name
<button onClick={handleClick}>
  <Icon />
</button>

// GOOD - with aria-label
<button onClick={handleClick} aria-label="Close dialog">
  <Icon />
</button>

// BAD - div as button
<div onClick={handleClick}>Click me</div>

// GOOD - semantic button
<button onClick={handleClick}>Click me</button>
```

---

## Known Issues & Technical Debt

### Type Safety Issues (as of Jan 2025)
- **223 `any` type usages** across 97 files
- High-priority files needing type fixes:
  - `web-app/app/.../proposals/[proposalId]/page.tsx` - 17 implicit any errors
  - `web-app/app/.../GenerateRFPDocumentModel.tsx` - 16 implicit any errors
  - `web-app/components/brief/helpers.ts` - 4 implicit any errors

### Infrastructure tsconfig Relaxations
Current relaxed settings that should be tightened:
- `noUnusedLocals: false` → should be `true`
- `noUnusedParameters: false` → should be `true`
- `strictPropertyInitialization: false` → should be `true`

### Sentry Issues Addressed
Tests cover these Sentry-reported issues:
- **AUTO-RFP-3V**: TypeError in index-document (text.trim() on non-string)
- **AUTO-RFP-51/52**: Missing required parameters in extract-questions
- **AUTO-RFP-2A**: JSON parsing errors from truncated Bedrock responses

---

## CI/CD Best Practices & Lessons Learned

### Test Synchronization with Code Changes

**When modifying Lambda handlers or hooks:**
- If you add/remove/rename required parameters, update ALL corresponding test files
- If you rename exported functions, search for mocks using the old name
- Run tests locally before pushing: `cd infrastructure && npm test` or `cd web-app && npm test`

**Example mistake:**
```typescript
// Handler changed to require knowledgeBaseId
if (!orgId || !documentId || !chunkKey || !knowledgeBaseId) throw new Error(...)

// But tests still had:
const event = { orgId: 'org-123', documentId: 'doc-123', chunkKey: '...' }; // Missing knowledgeBaseId!
```

### React Hooks Rules

**All hooks MUST be called before any conditional returns:**
```typescript
// BAD - hooks after early return
function Component({ id }) {
  const { data } = useQuery();
  if (!data) return <Loading />;  // Early return
  const [state, setState] = useState(''); // ❌ Hook after conditional!
  // ...
}

// GOOD - all hooks first
function Component({ id }) {
  const { data } = useQuery();
  const [state, setState] = useState(''); // ✅ All hooks at top

  if (!data) return <Loading />;  // Early return is fine after hooks
  // ...
}
```

### API Response Handling Consistency

**All SWR fetchers should extract the `data` field consistently:**
```typescript
// Our API returns: { data: { items: [...] } }

// BAD - returns full response
async function fetcher(url: string) {
  const res = await authFetcher(url);
  return res.json(); // Returns { data: { items: [...] } }
}

// GOOD - extracts data field
async function fetcher(url: string) {
  const res = await authFetcher(url);
  const json = await res.json();
  return json.data; // Returns { items: [...] }
}
```

### Package Manager Consistency

**Each directory uses a specific package manager - don't mix them:**
- `web-app/` → pnpm (pnpm-lock.yaml)
- `shared/` → pnpm (pnpm-lock.yaml)
- `infrastructure/` → npm (package-lock.json)

**Never add the wrong lock file to a directory** - CDK's NodejsFunction fails with "Multiple package lock files found" error.

### GitHub Actions: Artifacts vs Cache

**Use artifacts (not cache) for passing build outputs between jobs:**

```yaml
# BAD - Cache has propagation delays, unreliable between jobs
- uses: actions/cache@v4
  with:
    path: web-app/.next
    key: build-${{ github.sha }}

# GOOD - Artifacts are immediately available after upload
- uses: actions/upload-artifact@v4
  with:
    name: build-artifacts
    path: build-artifacts.tar.gz
```

### GitHub Actions: Next.js Build Artifacts

**Next.js creates files with special characters (colons) that artifacts reject:**
```
Error: Invalid character: node:inspector
```

**Solution: Use tar archive:**
```yaml
# Build job
- name: Create build archive
  run: tar -czf build-artifacts.tar.gz web-app/.next shared/dist

- uses: actions/upload-artifact@v4
  with:
    name: build-artifacts
    path: build-artifacts.tar.gz

# Test job
- uses: actions/download-artifact@v4
  with:
    name: build-artifacts

- name: Extract build
  run: tar -xzf build-artifacts.tar.gz
```

### Mock Function Names Must Match Imports

**When mocking modules, use the exact exported function name:**
```typescript
// If the code imports:
import { useCurrentOrganization } from '@/context/organization-context';

// The mock MUST use the same name:
jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({ ... }), // ✅ Correct name
  // NOT: useOrganization: () => ({ ... }) // ❌ Wrong name
}));
```

---

## Enhancement Tracking

See `task.md` in the repository root for:
- Planned enhancements and their status
- PR tracking for each improvement
- Priority and effort estimates
