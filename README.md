# AutoRFP - AI-Powered RFP Response Automation

AutoRFP is a comprehensive platform for automating RFP (Request for Proposal) response generation using AI.

## 📁 Project Structure

This is a monorepo managed with pnpm workspaces:

```
auto_rfp/
├── apps/
│   ├── web/              # Next.js frontend (@auto-rfp/web)
│   └── functions/        # AWS Lambda handlers (@auto-rfp/functions)
├── packages/
│   ├── core/             # Shared Zod schemas & types (@auto-rfp/core)
│   └── infra/            # AWS CDK infrastructure (@auto-rfp/infra)
└── scripts/              # Utility scripts
```

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- AWS CLI configured
- AWS account with appropriate permissions

### Installation

```bash
# Install all dependencies (automatically installs all workspace packages)
pnpm install

# Build all packages (core must build first)
pnpm build
```

### Development

```bash
# Run the web app in development mode
pnpm dev

# Run specific package
pnpm --filter @auto-rfp/web dev
pnpm --filter @auto-rfp/core build
```

### Environment Configuration

The web app requires environment variables. Copy the example file and update with your values:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Or fetch values from AWS CloudFormation (Dev environment):

```bash
# The .env.local file is already configured with Dev environment values
# Edit apps/web/.env.local if you need to change them
```

## 🏗️ Infrastructure Deployment

### Deploy All Stacks

```bash
# Deploy to Dev environment
pnpm deploy:dev

# Deploy to Test environment
pnpm deploy:test
```

### Deploy API Only (Fast)

```bash
# Deploy only API Gateway and Lambda functions to Dev
pnpm deploy:dev:api

# Deploy only API to Test
pnpm deploy:test:api
```

### CDK Commands

```bash
# Run any CDK command
pnpm cdk diff
pnpm cdk synth
pnpm cdk deploy <stack-name>
```

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests in specific package
pnpm --filter @auto-rfp/web test
pnpm --filter @auto-rfp/infra test

# Run E2E tests
pnpm --filter @auto-rfp/web test:e2e
```

## 📦 Available Packages

- **@auto-rfp/web** - Next.js 15+ frontend with App Router
- **@auto-rfp/functions** - AWS Lambda function handlers
- **@auto-rfp/core** - Shared Zod schemas and TypeScript types (built with tsup)
- **@auto-rfp/infra** - AWS CDK infrastructure definitions

## 🔧 Common Commands

```bash
# Development
pnpm install         # Install all dependencies
pnpm dev             # Run web app
pnpm test            # Run all tests
pnpm lint            # Lint all packages

# Deployment
pnpm deploy:dev      # Deploy all stacks to Dev
pnpm deploy:test     # Deploy all stacks to Test
pnpm deploy:dev:api  # Deploy only API to Dev (fast)
pnpm deploy:test:api # Deploy only API to Test (fast)
pnpm cdk             # Run CDK commands
```

## ⚡ Build Order

`packages/core` must be built first — both `apps/web` and `apps/functions` depend on it:

```bash
cd packages/core && pnpm build   # Always rebuild after changing schemas
```

## 📚 Documentation

- See `.clinerules/RULES.md` for detailed project conventions
- See `docs/` directory for feature-specific documentation

## 🌐 Environments

- **Dev** - Development environment (branch: `develop`)
- **Test** - Testing environment (branch: `main`)
- **Prod** - Production environment (branch: `production`)

## 🔐 Security

- All user data is encrypted at rest
- Authentication via AWS Cognito
- API secured with JWT tokens
- Infrastructure follows AWS Well-Architected Framework

## 📄 License

Private - All rights reserved
