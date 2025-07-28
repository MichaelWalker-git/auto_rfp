# AutoRFP - AI-Powered RFP Response Generator

A Next.js application that uses AI to help generate responses to Request for Proposals (RFPs). Built with AWS infrastructure for production scalability.

## 🚀 Quick Start (New Users)

### Prerequisites
- Node.js 18+ and pnpm installed
- AWS CLI configured with `rubywell` profile
- Git with SSH keys set up for GitHub

### 1. Clone and Setup
```bash
git clone git@github.com:run-llama/auto_rfp.git
cd auto_rfp
pnpm install
```

### 2. Environment Setup
Copy the environment template:
```bash
cp .env.example .env.local
```

Add your OpenAI API key to `.env.local`:
```bash
OPENAI_API_KEY=your_openai_api_key_here
```

### 3. Deploy AWS Infrastructure
```bash
cd infrastructure
npm install
npm run deploy
```

This will create:
- RDS PostgreSQL database
- AWS Cognito User Pool
- S3 bucket for documents
- VPC with proper networking
- AWS SES for emails

### 4. Set Up AWS Amplify
```bash
# Get infrastructure outputs
aws cloudformation describe-stacks \
  --stack-name AutoRfpInfrastructureStack \
  --profile rubywell \
  --output json > infrastructure-outputs.json

# Create Amplify app (run once)
aws amplify create-app \
  --name auto-rfp \
  --repository git@github.com:run-llama/auto_rfp.git \
  --profile rubywell

# Connect branch
aws amplify create-branch \
  --app-id YOUR_APP_ID \
  --branch-name main \
  --profile rubywell
```

### 5. Configure Environment Variables
Set the following in AWS Amplify Console or via CLI:
- `DATABASE_URL`: From infrastructure outputs
- `DIRECT_URL`: Same as DATABASE_URL
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`: From infrastructure outputs
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`: From infrastructure outputs
- `NEXT_PUBLIC_S3_BUCKET_NAME`: From infrastructure outputs
- `OPENAI_API_KEY`: Your OpenAI API key

### 6. Deploy Application
```bash
git add .
git commit -m "Initial setup"
git push origin main
```

AWS Amplify will automatically build and deploy your application.

## 🏃‍♂️ Running Locally

```bash
# Start development server
pnpm dev

# Run database migrations
pnpm prisma migrate dev

# Generate Prisma client
pnpm prisma generate
```

## 📋 Current Status

### ✅ Completed
- AWS infrastructure deployed
- Database configured
- Authentication system (Cognito)
- Build pipeline (AWS Amplify)
- File storage (S3)

### 🔄 In Progress
- RDS networking optimization
- Full authentication integration
- Database migration automation

## 🛠️ Development Commands

```bash
# Database operations
pnpm prisma studio          # Open database GUI
pnpm prisma migrate dev      # Create and run migrations
pnpm prisma generate         # Generate Prisma client

# Build and test
pnpm build                   # Build for production
pnpm start                   # Start production server
pnpm lint                    # Run linter

# Infrastructure
cd infrastructure
npm run deploy               # Deploy AWS infrastructure
npm run destroy              # Destroy AWS infrastructure (careful!)
```

## 🔧 AWS CLI Commands

### Check Application Status
```bash
# List Amplify apps
aws amplify list-apps --profile rubywell --output table

# Check build status
aws amplify list-jobs \
  --app-id YOUR_APP_ID \
  --branch-name main \
  --profile rubywell \
  --output table

# Check database status
aws rds describe-db-instances \
  --profile rubywell \
  --output table
```

### Manage Environment Variables
```bash
# Get current environment variables
aws amplify get-branch \
  --app-id YOUR_APP_ID \
  --branch-name main \
  --profile rubywell \
  --query 'branch.environmentVariables' \
  --output table

# Update environment variables
aws amplify update-branch \
  --app-id YOUR_APP_ID \
  --branch-name main \
  --environment-variables '{"KEY":"VALUE"}' \
  --profile rubywell
```

## 📁 Project Structure

```
auto_rfp/
├── app/                     # Next.js app directory
│   ├── api/                 # API routes
│   ├── auth/                # Authentication pages
│   ├── organizations/       # Organization management
│   └── projects/            # Project management
├── components/              # React components
├── lib/                     # Utility libraries
│   ├── utils/cognito/       # AWS Cognito utilities
│   └── services/            # Business logic
├── infrastructure/          # AWS CDK infrastructure
├── prisma/                  # Database schema and migrations
├── local-docs/              # Development documentation
└── amplify.yml              # AWS Amplify build configuration
```

## 🚨 Troubleshooting

### Common Issues

**Build fails with database connection errors:**
```bash
# Check if RDS is in public subnets
aws rds describe-db-instances \
  --db-instance-identifier YOUR_DB_ID \
  --profile rubywell \
  --query 'DBInstances[0].PubliclyAccessible'

# Check security groups
aws ec2 describe-security-groups \
  --group-ids YOUR_SG_ID \
  --profile rubywell
```

**1Password SSH issues:**
```bash
# Disable commit signing
git config --global commit.gpgsign false

# Use regular SSH agent
unset SSH_AUTH_SOCK
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

**Environment variable errors:**
```bash
# Check all environment variables are set
aws amplify get-branch \
  --app-id YOUR_APP_ID \
  --branch-name main \
  --profile rubywell \
  --query 'branch.environmentVariables'
```

## 📚 Documentation

- **Architecture**: [local-docs/aws-migration-plan.md](local-docs/aws-migration-plan.md)
- **Troubleshooting**: [local-docs/aws-migration-lessons-learned.md](local-docs/aws-migration-lessons-learned.md)
- **RDS Networking**: [local-docs/rds-networking-issue-and-solution.md](local-docs/rds-networking-issue-and-solution.md)
- **Quick Start**: [local-docs/quick-start-guide.md](local-docs/quick-start-guide.md)

## 🔗 Important URLs

- **AWS Amplify Console**: `https://console.aws.amazon.com/amplify/`
- **Live Application**: `https://main.dk7mzhfo2065a.amplifyapp.com`
- **RDS Console**: `https://console.aws.amazon.com/rds/`
- **Cognito Console**: `https://console.aws.amazon.com/cognito/`

## 💰 Cost Information

Estimated monthly costs:
- RDS PostgreSQL (t3.micro): ~$15.00
- S3 Storage: ~$0.25
- Cognito: Free (up to 50k users)
- AWS SES: ~$0.10
- AWS Amplify: ~$0.15

**Total**: ~$15.50/month

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

---

For urgent issues or questions, check the troubleshooting documentation in `local-docs/` or create an issue in the GitHub repository.
