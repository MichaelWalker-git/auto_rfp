# AWS Partner POC Funding Request - Cost Estimate

## Project: AutoRFP - AI-Powered RFP Response Automation Platform
## Customer: VRC
## POC Duration: 2.5 months
## Requested Credits: $15,000

---

## Executive Summary

AutoRFP is an enterprise-grade AI-powered RFP (Request for Proposals) response automation platform that helps government contractors:
- Process RFP documents and extract questions automatically
- Generate AI-powered answers using RAG (Retrieval Augmented Generation)
- Create executive opportunity briefs with GO/NO-GO recommendations
- Search SAM.gov for government contract opportunities
- Generate professional proposals

The POC will demonstrate the platform's capabilities to VRC over a 2.5-month period with realistic workloads.

---

## AWS Services Architecture

### Core Services Used

| Service | Purpose |
|---------|---------|
| Amazon Bedrock | Claude 3 Haiku (text generation), Titan Embed V2 (embeddings) |
| Amazon OpenSearch Serverless | Vector search for RAG document retrieval |
| Amazon DynamoDB | Single-table design for all entities |
| Amazon S3 | Document storage (RFPs, knowledge base files) |
| AWS Lambda | ~75 serverless functions across 16 API domains |
| AWS Step Functions | 2 pipelines (document processing, question extraction) |
| Amazon Textract | PDF/image text extraction |
| Amazon API Gateway | REST API with Cognito authorization |
| Amazon Cognito | User authentication with advanced security |
| Amazon SQS | Executive brief async job processing |
| AWS Secrets Manager | API key storage (SAM.gov, Linear) |
| Amazon CloudWatch | Logging, metrics, and monitoring |
| Amazon SNS | Textract completion notifications |
| Amazon EventBridge | Scheduled saved search execution (hourly) |

---

## AWS Services Cost Breakdown

### 1. Amazon Bedrock (AI/ML - Primary Cost Driver)

**Claude 3 Haiku (Answer Generation, Question Extraction, Executive Briefs)**
- Model: `anthropic.claude-3-haiku-20240307-v1:0`
- Use cases:
  - Answer generation with RAG context
  - Question extraction from RFP documents
  - Executive brief section generation (6 sections per opportunity)
  - Opportunity field fulfillment
- Estimated monthly invocations: 50,000
- Average input tokens per call: 8,000
- Average output tokens per call: 2,000
- Input cost: $0.00025/1K tokens = $100/month
- Output cost: $0.00125/1K tokens = $125/month
- **Monthly subtotal: $225**

**Amazon Titan Text Embeddings V2**
- Model: `amazon.titan-embed-text-v2:0`
- Use cases:
  - Document chunk embeddings for RAG
  - Query embeddings for semantic search
- Estimated monthly chunks to embed: 500,000
- Average tokens per chunk: 500
- Cost: $0.00002/1K tokens
- **Monthly subtotal: $5**

**Bedrock Monthly Total: $230**
**2.5 Month Total: $575**

---

### 2. Amazon OpenSearch Serverless (Vector Search)

**SEARCH Collection for RAG embeddings**
- Collection type: SEARCH (optimized for vector similarity)
- Configuration: Encryption enabled, network policies configured
- Index OCU-Hours: ~720/month (1 OCU continuous)
- Search OCU-Hours: ~1,440/month (2 OCUs for queries)
- Cost: $0.24/OCU-hour
- Index: 720 × $0.24 = $172.80
- Search: 1,440 × $0.24 = $345.60
- Storage: ~100GB @ $0.024/GB-hour × 720 = $172.80
- **Monthly subtotal: $691.20**

**2.5 Month Total: $1,728**

---

### 3. Amazon DynamoDB (Database)

**Single-Table Design with On-Demand Capacity**
- Billing mode: PAY_PER_REQUEST
- Point-in-time recovery: Enabled
- Encryption: AWS managed
- DynamoDB Streams: NEW_IMAGE view type
- Read requests: ~5M/month @ $0.25/million = $1.25
- Write requests: ~2M/month @ $1.25/million = $2.50
- Storage: ~50GB @ $0.25/GB = $12.50
- Point-in-time recovery: $0.20/GB = $10
- Stream reads: ~1M/month @ $0.02/100K = $0.20
- **Monthly subtotal: $26.45**

**2.5 Month Total: $66.13**

---

### 4. AWS Lambda (Serverless Compute)

**~75 Lambda Functions across domains:**
- Organization management (5 functions)
- Project management (5 functions)
- Document processing (6 functions)
- Knowledge base management (5 functions)
- Question extraction pipeline (7 functions)
- Answer generation (3 functions)
- Proposal generation (4 functions)
- Executive brief generation (11 functions)
- SAM.gov integration (7 functions)
- User management (4 functions)
- Semantic search (1 function)
- Deadlines (2 functions)
- Presigned URLs (1 function)
- Prompt management (2 functions)
- Opportunity management (3 functions)
- Pipeline workers (9 functions)

**Specifications:**
- Runtime: Node.js 20.x
- Memory: 1024MB (most functions)
- Timeout: 15s-15min (varies by function)
- Estimated monthly invocations: 500,000
- Average duration: 500ms
- Cost per 1M requests: $0.20
- Cost per GB-second: $0.0000166667
- Invocation cost: 0.5M × $0.20 = $0.10
- Compute cost: 500K × 0.5s × 1GB × $0.0000166667 = $4.17
- **Monthly subtotal: $4.27**

**2.5 Month Total: $10.68**

---

### 5. AWS Step Functions (Orchestration)

**Document Processing Pipeline**
- Steps: StartProcessing → PDF/DOCX Processing → Textract → Chunk → Index
- Supports: PDF, DOCX, images (PNG, JPG, TIFF)
- Chunk size: 2,500 chars with 250-char overlap

**Question Extraction Pipeline**
- Steps: File Routing → Textract/DOCX Extract → Process Result → Fulfill Fields → Extract Questions
- Uses async Textract with SNS callback pattern

**Combined Usage:**
- State transitions: 500,000/month
- Cost: $0.025/1K transitions
- **Monthly subtotal: $12.50**

**2.5 Month Total: $31.25**

---

### 6. Amazon API Gateway (REST API)

**HTTP API Configuration**
- CORS enabled for all origins
- Cognito authorizer for all protected routes
- Logging: INFO level with data trace enabled
- 16 nested API stacks (resource domains)

**Usage:**
- Estimated monthly requests: 500,000
- Cost: $1.00 per million
- **Monthly subtotal: $0.50**

**2.5 Month Total: $1.25**

---

### 7. Amazon S3 (Document Storage)

**Documents Bucket**
- Lifecycle: Transition to IA after 30 days
- Storage: ~500GB @ $0.023/GB = $11.50
- PUT requests: 100K/month @ $0.005/1K = $0.50
- GET requests: 500K/month @ $0.0004/1K = $0.20
- Data transfer: 50GB/month @ $0.09/GB = $4.50
- **Monthly subtotal: $16.70**

**2.5 Month Total: $41.75**

---

### 8. Amazon Textract (Document Processing)

**Asynchronous Document Text Detection**
- Used for: PDF text extraction, image OCR
- SNS notification on completion
- Pages processed: 50,000/month
- Detect Document Text: $0.0015/page
- **Monthly subtotal: $75**

**2.5 Month Total: $187.50**

---

### 9. Amazon Cognito (Authentication)

**User Pool Configuration**
- Self sign-up enabled
- Email sign-in
- Advanced Security Mode: ENFORCED
- Custom attributes: orgId, userId, roles, role
- Password policy: 8+ chars, all character types required
- Monthly Active Users: 100
- First 50,000 MAUs: Free
- Advanced Security (per MAU with risk): ~$0.05 × 100 = $5
- **Monthly subtotal: $5**

**2.5 Month Total: $12.50**

---

### 10. Amazon SQS (Message Queue)

**Executive Brief Processing Queue**
- Visibility timeout: 60 seconds
- Retention: 4 days
- Dead letter queue with 14-day retention
- Max receive count before DLQ: 5
- Batch size: 5 messages
- Messages: 100,000/month
- Cost: $0.40/million messages
- **Monthly subtotal: $0.04**

**2.5 Month Total: $0.10**

---

### 11. AWS Secrets Manager

**Secret Storage**
- SAM.gov API key
- Linear API key (for issue tracking integration)
- 2+ secrets @ $0.40/secret/month = $0.80
- API calls: 50,000/month @ $0.05/10K = $0.25
- **Monthly subtotal: $1.05**

**2.5 Month Total: $2.63**

---

### 12. Amazon CloudWatch (Monitoring & Logs)

**Logs and Metrics**
- Log retention: 1 week (pipeline functions)
- Log ingestion: 50GB/month @ $0.50/GB = $25
- Log storage: 100GB @ $0.03/GB = $3
- Custom metrics: 50 @ $0.30 each = $15
- Dashboards: 3 @ $3 each = $9
- **Monthly subtotal: $52**

**2.5 Month Total: $130**

---

### 13. Amazon SNS (Notifications)

**Textract Completion Topic**
- Used for async Textract job completion callbacks
- Messages: 50,000/month
- Cost: $0.50/million + delivery charges
- **Monthly subtotal: $0.50**

**2.5 Month Total: $1.25**

---

### 14. Amazon EventBridge (Scheduling)

**Saved Search Runner**
- Hourly execution of SAM.gov saved searches
- Rule invocations: 720/month (24 × 30)
- Cost: Included in Lambda invocations
- **Monthly subtotal: $0**

**2.5 Month Total: $0**

---

## Cost Summary

| Service | Monthly Cost | 2.5 Month Cost |
|---------|-------------|----------------|
| Amazon OpenSearch Serverless | $691.20 | $1,728.00 |
| Amazon Bedrock | $230.00 | $575.00 |
| Amazon Textract | $75.00 | $187.50 |
| Amazon CloudWatch | $52.00 | $130.00 |
| Amazon DynamoDB | $26.45 | $66.13 |
| Amazon S3 | $16.70 | $41.75 |
| AWS Step Functions | $12.50 | $31.25 |
| Amazon Cognito | $5.00 | $12.50 |
| AWS Lambda | $4.27 | $10.68 |
| AWS Secrets Manager | $1.05 | $2.63 |
| Amazon API Gateway | $0.50 | $1.25 |
| Amazon SNS | $0.50 | $1.25 |
| Amazon SQS | $0.04 | $0.10 |
| Amazon EventBridge | $0.00 | $0.00 |
| **SUBTOTAL** | **$1,115.21** | **$2,788.04** |

---

## Additional Considerations

### Production Environment
- Base cost for 2.5 months: $2,788.04

### Development & Testing Environment
- Parallel dev/staging stack: ~$2,788

### Usage Buffer for Testing (2x)
- Increased testing load during POC: ~$2,788

### Contingency (50%)
- Reserve for unforeseen usage: ~$4,182

**Calculation:**
- $2,788 × 3 environments/load = $8,364
- $8,364 + 50% contingency = $12,546
- Rounded up: $15,000

---

## Total Requested: $15,000

This estimate includes buffer to account for:
1. **Parallel environments** - Production and dev/staging stacks
2. **Testing load** - Increased usage during POC demonstrations
3. **OpenSearch Serverless** - OCU-based pricing requires always-on compute (largest cost driver)
4. **Document volume** - Government RFPs can be 100+ pages each
5. **Contingency** - 50% buffer for unforeseen spikes

---

## Architecture Highlights for VRC POC

### Serverless & Scalable
- 100% serverless architecture - no servers to manage
- Auto-scales from 0 to thousands of concurrent users
- Pay-per-use model minimizes idle costs

### AI-Powered Document Intelligence
- **Claude 3 Haiku**: Fast, cost-effective LLM for answer generation
- **Titan Embeddings V2**: High-quality vector embeddings for semantic search
- **Amazon Textract**: Enterprise-grade OCR for PDF/image processing

### Enterprise Security
- **Cognito Advanced Security**: Risk-based adaptive authentication
- **Encryption at rest**: All data encrypted (DynamoDB, S3, OpenSearch)
- **VPC-ready**: Can be deployed within customer VPC
- **RBAC**: Role-based access control (Owner, Admin, Editor, Viewer, Member)

### SAM.gov Integration
- Direct API integration with SAM.gov
- Automated opportunity monitoring with saved searches
- Hourly scheduled search execution via EventBridge

---

## Business Value for VRC

1. **Time Savings**: Reduce RFP response time from weeks to days
2. **Quality Improvement**: AI-assisted answers with knowledge base citations
3. **Opportunity Intelligence**: Automated SAM.gov monitoring and executive briefs
4. **Compliance**: Structured question extraction ensures nothing is missed
5. **Scalability**: Process multiple RFPs simultaneously
6. **GO/NO-GO Decisions**: AI-powered scoring and risk assessment

---

## Technical Specifications

### Lambda Function Distribution

| Domain | Function Count | Description |
|--------|---------------|-------------|
| Organization | 5 | CRUD operations for organizations |
| Project | 5 | Project management |
| Document | 6 | Document CRUD and pipeline |
| Knowledge Base | 5 | Knowledge base management |
| Question Pipeline | 7 | Question extraction workflow |
| Answer | 3 | AI answer generation |
| Proposal | 4 | Proposal generation and export |
| Executive Brief | 11 | 6-section brief generation |
| SAM.gov | 7 | SAM.gov API integration |
| User | 4 | User management |
| Semantic | 1 | Semantic search |
| Deadlines | 2 | Deadline extraction/export |
| Presigned | 1 | S3 presigned URLs |
| Prompt | 2 | Custom prompt management |
| Opportunity | 3 | Opportunity management |
| Pipeline Workers | 9 | Step Function handlers |
| **Total** | **~75** | |

### Step Function Pipelines

**Document Pipeline:**
```
Upload → S3 → StartProcessing → Route by Type
  → PDF: Textract → Chunk → Index
  → DOCX: Extract Text → Chunk → Index
```

**Question Pipeline:**
```
Upload → S3 → Route by Type
  → PDF: Textract (async) → Process Result → Fulfill Fields → Extract Questions
  → DOCX: Extract Text → Fulfill Fields → Extract Questions
```

---

## Next Steps

1. Submit AWS Partner Funding Portal request at: https://partnercentral.awspartner.com
2. Navigate to: Programs > AWS Partner Funding Portal
3. Select: SCA Non-Standard Proof of Concept funding type
4. Attach this cost estimate document
5. Include customer (VRC) contact information
6. Specify 2.5 month duration
7. Associate VRC opportunity (O11279251)

---

*Document prepared for AWS Partner POC Funding Request*
*Project: AutoRFP*
*Application ID: benappl-jziako0zlnbmr4 (Standard POC - $15K cap)*
*Previous Application: benappl-naz0r9gfq4nf22 (Non-Standard POC - $40K)*
*Date: January 2026*
