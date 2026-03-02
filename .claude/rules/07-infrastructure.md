# Infrastructure (AWS CDK)

> AWS infrastructure definitions and deployment patterns.

---

## 🏗️ CDK Organization

- All infrastructure is defined in `packages/infra/lib/`.

- Stacks are organized by concern:
  - `api/` — API Gateway + Lambda function definitions
  - `database-stack.ts` — DynamoDB table + GSIs
  - `auth-stack.ts` — Cognito User Pool + Client
  - `amplify-fe-stack.ts` — Amplify Hosting for frontend
  - `storage-stack.ts` — S3 buckets for file storage
  - `network-stack.ts` — VPC and networking resources

- Stack outputs are used to pass values between stacks (e.g., table name, user pool ID).

- Environment variables are passed to Lambda functions for resource references.

- Multi-stage support via environment-specific configurations.

---

## 🌐 Frontend Deployment

- **Frontend is deployed via AWS Amplify Hosting** (not S3 + CloudFront).
- The CDK stack uses `@aws-cdk/aws-amplify-alpha` to define the Amplify app.
- The built `apps/web/dist` is deployed as an S3 asset to an Amplify branch.
