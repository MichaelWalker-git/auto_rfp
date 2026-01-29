# Tasks

Active tasks for the AutoRFP project.

## In Progress

### Fix CI/CD Pipeline Issues
- [x] Missing PINECONE_API_KEY - Added Pinecone API key and index name to GitHub secrets
- [x] Lock file conflict - Removed pnpm-lock.yaml from infrastructure, added package-lock.json
- [x] Docker bundling issue - Installed esbuild globally for local Lambda bundling
- [x] IAM permissions - Added AmplifyFeStack-* to CloudFormation resources in IAM policy
- [x] Infrastructure deployment workflow now working
- [x] **ESLint 9 configuration** - Using native flat config with @next/eslint-plugin-next
- [ ] **React Hooks violations** - Fixed conditional hooks in ProposalsContent, DocumentsSection, ProjectOverview, CancelPipelineButton

### GitHub Secrets Added
- [x] `PINECONE_API_KEY` - Pinecone vector database API key
- [x] `PINECONE_INDEX` - Pinecone index name (documents)

## CI Status

| Workflow | Status | Notes |
|----------|--------|-------|
| Deploy Infrastructure | Passing | All 8 CDK stacks deployed |
| E2E Tests | Passing | Playwright tests running |
| Unit Tests | **Failing** | ESLint 9 config issue |
| Lighthouse CI | Running | Performance audits |

## Infrastructure Stacks Deployed

- AutoRfp-Network
- AutoRfp-Auth-Dev
- AutoRfp-Storage-Dev
- AutoRfp-DynamoDatabase-Dev
- AutoRfp-DocumentPipeline-Dev
- AutoRfp-QuestionsPipeline-Dev
- AutoRfp-API-Dev
- AmplifyFeStack-Dev

## Next Steps

1. Fix ESLint 9 configuration to use native flat config format
2. Verify all CI workflows pass
3. Review E2E test coverage gaps
