# CDK Deployment Guide

## Problem
The CDK application contains multiple stacks (25+ stacks) including nested stacks created by the `ApiOrchestratorStack`. When running `cdk deploy` without specifying stacks, CDK requires you to either specify which stacks to deploy or use the `--all` flag.

## Stack Structure
The application consists of the following main stacks:
- **AutoRfp-Network**: VPC and networking infrastructure
- **AutoRfp-Auth-Dev**: Cognito user pool and authentication
- **AutoRfp-Storage-Dev**: S3 buckets for document storage
- **AutoRfp-DynamoDatabase-Dev**: DynamoDB tables
- **AutoRfp-DocumentPipeline-Dev**: Step Functions for document processing
- **AutoRfp-QuestionsPipeline-Dev**: Step Functions for question extraction
- **ApiOrchestrator-Dev**: Main API stack with nested route stacks:
  - ApiFacade
  - SharedInfra
  - OrganizationRoutes
  - AnswerRoutes
  - PresignedRoutes
  - KnowledgebaseRoutes
  - DocumentRoutes
  - QuestionfileRoutes
  - ProposalRoutes
  - UserRoutes
  - QuestionRoutes
  - SemanticRoutes
  - DeadlinesRoutes
  - OpportunityRoutes
  - ExportRoutes
  - ContentLibraryRoutes
  - ProjectOutcomeRoutes
  - FoiaRoutes
  - DebriefingRoutes
  - ProjectsRoutes
  - PromptRoutes
- **AmplifyFeStack-Dev**: Frontend Amplify application

## Solution

### Quick Fix
To deploy all stacks immediately:
```bash
cd infrastructure
cdk deploy --all
```

### Using the Deployment Script
A deployment script (`deploy.sh`) has been created to simplify the deployment process:

```bash
# Deploy all stacks
./deploy.sh --all

# Deploy only core infrastructure
./deploy.sh --core

# Deploy only API stacks
./deploy.sh --api

# Deploy only frontend
./deploy.sh --frontend

# Show help
./deploy.sh --help

# Clean up failed stacks
./deploy.sh --cleanup
```

### Using NPM Scripts
The package.json has been updated with convenient npm scripts:

```bash
# Deploy all stacks
npm run deploy

# Deploy all stacks (alternative)
npm run deploy:all

# Deploy core infrastructure only
npm run deploy:core

# Deploy API stacks only
npm run deploy:api

# Deploy frontend only
npm run deploy:frontend

# Clean up failed stacks
npm run cleanup
```

## Deployment Order
When deploying manually, follow this order due to dependencies:
1. AutoRfp-Network
2. AutoRfp-Auth-Dev
3. AutoRfp-Storage-Dev
4. AutoRfp-DynamoDatabase-Dev
5. AutoRfp-DocumentPipeline-Dev
6. AutoRfp-QuestionsPipeline-Dev
7. ApiOrchestrator-Dev (and all its nested stacks)
8. AmplifyFeStack-Dev

## Common Commands

### Deploy specific stacks with wildcards
```bash
# Deploy all API-related stacks
cdk deploy "ApiOrchestrator-Dev/*"

# Deploy all AutoRfp stacks
cdk deploy "AutoRfp-*"
```

### Deploy with specific profile
```bash
cdk deploy --all --profile michael-primary
```

### Deploy without approval
```bash
cdk deploy --all --require-approval never
```

### Check what will be deployed
```bash
cdk diff --all
```

### Destroy all stacks
```bash
cdk destroy --all
```

## Troubleshooting

### Error: "Since this app includes more than a single stack..."
This error occurs when running `cdk deploy` without specifying stacks. Use one of these solutions:
- Add `--all` flag: `cdk deploy --all`
- Specify stack names: `cdk deploy AutoRfp-Network AutoRfp-Auth-Dev`
- Use the deployment script: `./deploy.sh --all`

### Error: "auto-rfp-api-lambda-role-Dev already exists in stack"
This error occurs when there's a naming conflict with resources from a previous deployment. The IAM role name has been updated to `auto-rfp-api-orchestrator-lambda-role-Dev` to avoid conflicts.

**Solution:**
1. Clean up the failed stack:
   ```bash
   ./deploy.sh --cleanup
   ```
2. Or manually delete the failed stack from AWS Console
3. Redeploy with the updated configuration:
   ```bash
   ./deploy.sh --all
   ```

### CloudFormation Resource Limit
If you encounter CloudFormation resource limits (500 resources per stack), the application already uses nested stacks to distribute resources. Each API route domain has its own nested stack to avoid this limit.

### Profile Issues
If you encounter AWS profile issues, ensure you have the correct profile configured:
```bash
aws configure --profile michael-primary
```

Or set the environment variable:
```bash
export AWS_PROFILE=michael-primary
```

## Best Practices
1. Always run `cdk diff` before deploying to review changes
2. Use `--require-approval never` only in CI/CD pipelines
3. Deploy core infrastructure before API and frontend stacks
4. Monitor CloudFormation console for deployment progress
5. Keep nested stacks to manage resource limits effectively