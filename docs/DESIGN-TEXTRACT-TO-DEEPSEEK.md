# Design Document: Replace Textract with DeepSeek ECS Text Extraction

## Overview

Replace AWS Textract with a self-hosted DeepSeek LLM running on ECS for document text extraction. This provides better control, cost predictability, and potentially higher quality extraction for RFP-specific documents.

## Current State: Textract Integration

### Files Using Textract (13 files)

| File | Purpose |
|------|---------|
| `infrastructure/lib/document-pipeline-step-function.ts` | Step Function orchestration |
| `infrastructure/lib/question-pipeline-step-function.ts` | Question extraction pipeline |
| `infrastructure/lambda/helpers/textract.ts` | Shared Textract utilities |
| `infrastructure/lambda/document-pipeline-steps/pdf-processing.ts` | Document processing |
| `infrastructure/lambda/document-pipeline-steps/textract-callback.ts` | Async callback handler |
| `infrastructure/lambda/question-pipeline/start-question-textract.ts` | Start Textract job |
| `infrastructure/lambda/question-pipeline/textract-question-callback.ts` | Question callback |
| `infrastructure/lambda/question-pipeline/process-question-file.ts` | Process extracted text |

### Current Architecture

```
Document Upload
      │
      v
┌─────────────────┐
│  Step Function  │
│  (Orchestrator) │
└────────┬────────┘
         │
         v
┌─────────────────┐     ┌─────────────────┐
│ Start Textract  │────>│   AWS Textract  │
│    Lambda       │     │   (Async Job)   │
└─────────────────┘     └────────┬────────┘
                                 │
                                 v SNS Notification
                        ┌─────────────────┐
                        │ Textract        │
                        │ Callback Lambda │
                        └────────┬────────┘
                                 │
                                 v
                        ┌─────────────────┐
                        │ Process Text    │
                        │ (Chunk/Embed)   │
                        └─────────────────┘
```

### Current Pain Points

1. **Task Timeouts (AUTO-RFP-47)** - 54 occurrences of `TaskTimedOut: Task Timed Out`
2. **Invalid Parameters (AUTO-RFP-66)** - Textract rejecting certain file types
3. **Cost Unpredictability** - Per-page pricing makes costs hard to forecast
4. **Limited Control** - Can't tune extraction for RFP-specific layouts
5. **Async Complexity** - SNS callbacks add failure points

---

## Proposed Architecture: DeepSeek ECS

### Target Architecture

```
Document Upload
      │
      v
┌─────────────────┐
│  Step Function  │
│  (Orchestrator) │
└────────┬────────┘
         │
         v
┌─────────────────┐     ┌─────────────────────────────┐
│ Extract Text    │────>│   DeepSeek ECS Service      │
│    Lambda       │     │   (Vision + OCR Model)      │
└─────────────────┘     │                             │
         │              │  ┌─────────────────────┐    │
         │              │  │ DeepSeek-VL or      │    │
         │              │  │ DeepSeek-V2         │    │
         │              │  └─────────────────────┘    │
         │              └──────────────┬──────────────┘
         │                             │
         │<────────────────────────────┘
         │         (Synchronous HTTP)
         v
┌─────────────────┐
│ Process Text    │
│ (Chunk/Embed)   │
└─────────────────┘
```

### Key Differences

| Aspect | Textract | DeepSeek ECS |
|--------|----------|--------------|
| **Invocation** | Async (SNS callback) | Sync (HTTP) |
| **Pricing** | Per-page | Fixed ECS cost |
| **Timeout** | 5 min default | Configurable |
| **Customization** | None | Prompt engineering |
| **Scaling** | Managed | Auto-scaling ECS |

---

## ECS Service Design

### Container Configuration

```typescript
// infrastructure/lib/deepseek-ecs-stack.ts

const taskDefinition = new ecs.FargateTaskDefinition(this, 'DeepSeekTask', {
  memoryLimitMiB: 16384,  // 16 GB for model
  cpu: 4096,              // 4 vCPU
});

taskDefinition.addContainer('DeepSeekContainer', {
  image: ecs.ContainerImage.fromRegistry('deepseek/deepseek-vl:latest'),
  memoryLimitMiB: 16384,
  portMappings: [{ containerPort: 8080 }],
  environment: {
    MODEL_PATH: '/models/deepseek-vl-7b',
    MAX_TOKENS: '4096',
    BATCH_SIZE: '1',
  },
  logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'deepseek' }),
});

const service = new ecs.FargateService(this, 'DeepSeekService', {
  cluster,
  taskDefinition,
  desiredCount: 1,
  assignPublicIp: false,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
});

// Auto-scaling
const scaling = service.autoScaleTaskCount({
  minCapacity: 1,
  maxCapacity: 4,
});

scaling.scaleOnCpuUtilization('CpuScaling', {
  targetUtilizationPercent: 70,
  scaleInCooldown: Duration.minutes(5),
  scaleOutCooldown: Duration.minutes(2),
});
```

### API Endpoint

```typescript
// ALB for internal access
const lb = new elbv2.ApplicationLoadBalancer(this, 'DeepSeekALB', {
  vpc,
  internetFacing: false,
});

const listener = lb.addListener('Listener', { port: 80 });
listener.addTargets('DeepSeekTarget', {
  port: 8080,
  targets: [service],
  healthCheck: {
    path: '/health',
    interval: Duration.seconds(30),
  },
});

// VPC Endpoint for Lambda access
new ec2.InterfaceVpcEndpoint(this, 'DeepSeekEndpoint', {
  vpc,
  service: new ec2.InterfaceVpcEndpointService(lb.loadBalancerDnsName, 80),
});
```

---

## Lambda Integration

### New Text Extraction Lambda

```typescript
// infrastructure/lambda/document-pipeline-steps/extract-text-deepseek.ts

import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

interface ExtractTextEvent {
  bucket: string;
  key: string;
  documentId: string;
  projectId: string;
}

interface ExtractTextResult {
  text: string;
  pageCount: number;
  confidence: number;
  metadata: {
    extractionMethod: 'deepseek';
    modelVersion: string;
    processingTimeMs: number;
  };
}

const DEEPSEEK_ENDPOINT = process.env.DEEPSEEK_ENDPOINT!;

export const handler: Handler<ExtractTextEvent, ExtractTextResult> = async (event) => {
  const { bucket, key, documentId, projectId } = event;

  // Download document from S3
  const s3 = new S3Client({});
  const { Body, ContentType } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

  const documentBytes = await Body?.transformToByteArray();
  if (!documentBytes) throw new Error('Empty document');

  // Convert to base64 for API
  const base64Doc = Buffer.from(documentBytes).toString('base64');

  const startTime = Date.now();

  // Call DeepSeek ECS service
  const response = await fetch(`${DEEPSEEK_ENDPOINT}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document: base64Doc,
      contentType: ContentType,
      options: {
        extractTables: true,
        preserveLayout: true,
        ocrFallback: true,
      },
    }),
    signal: AbortSignal.timeout(300000), // 5 min timeout
  });

  if (!response.ok) {
    throw new Error(`DeepSeek extraction failed: ${response.status}`);
  }

  const result = await response.json();

  return {
    text: result.text,
    pageCount: result.pageCount,
    confidence: result.confidence,
    metadata: {
      extractionMethod: 'deepseek',
      modelVersion: result.modelVersion,
      processingTimeMs: Date.now() - startTime,
    },
  };
};
```

---

## Step Function Migration

### Before (Textract)

```yaml
StartTextract:
  Type: Task
  Resource: arn:aws:lambda:...:start-textract
  Next: WaitForTextract

WaitForTextract:
  Type: Task
  Resource: arn:aws:states:::sqs:sendMessage.waitForTaskToken
  Parameters:
    QueueUrl: ${TextractCallbackQueue}
    MessageBody:
      TaskToken.$: $$.Task.Token
  TimeoutSeconds: 300
  Next: ProcessText
```

### After (DeepSeek)

```yaml
ExtractText:
  Type: Task
  Resource: arn:aws:lambda:...:extract-text-deepseek
  TimeoutSeconds: 300
  Retry:
    - ErrorEquals: ["Lambda.ServiceException", "Lambda.TooManyRequestsException"]
      IntervalSeconds: 2
      MaxAttempts: 3
      BackoffRate: 2
  Next: ProcessText
```

**Key Simplification**: No more async callback pattern - synchronous invocation reduces failure points.

---

## Migration Strategy

### Phase 1: Parallel Deployment (Week 1-2)
- Deploy DeepSeek ECS service alongside existing Textract
- Add feature flag to route specific document types to DeepSeek
- Monitor quality and performance metrics

### Phase 2: Gradual Rollout (Week 3-4)
- Route 10% of traffic to DeepSeek
- Increase to 50% if metrics are good
- Compare extraction quality side-by-side

### Phase 3: Full Migration (Week 5-6)
- Route 100% to DeepSeek
- Deprecate Textract Lambdas
- Remove SNS/SQS callback infrastructure

### Phase 4: Cleanup (Week 7)
- Delete Textract-related code
- Update documentation
- Cost analysis

---

## Cost Analysis

### Current Textract Costs (Estimated)

| Volume | Textract Cost | Notes |
|--------|---------------|-------|
| 1,000 pages/month | $15 | $0.015/page |
| 10,000 pages/month | $150 | |
| 100,000 pages/month | $1,500 | |

### Projected DeepSeek ECS Costs

| Configuration | Monthly Cost | Notes |
|---------------|--------------|-------|
| 1x Fargate (4vCPU/16GB) | ~$200 | Always-on |
| 2x Fargate (scaled) | ~$300-400 | Auto-scaling |
| 4x Fargate (peak) | ~$600-800 | High volume |

**Break-even Point**: ~13,000 pages/month

### Cost Optimization Options

1. **Spot Instances**: Use Fargate Spot for 60-70% savings
2. **Scale to Zero**: Implement scale-to-zero during off-hours
3. **GPU Instances**: Consider g4dn.xlarge for faster inference

---

## Quality Considerations

### Expected Improvements

1. **RFP-Specific Training**: Can fine-tune on RFP documents
2. **Table Extraction**: Better handling of complex tables
3. **Form Recognition**: Improved SF-330, SF-1449 parsing
4. **Multi-Column Layout**: Better handling of proposal formats

### Potential Risks

1. **Model Size**: May need larger instance for quality
2. **Latency**: LLM inference slower than Textract for simple docs
3. **Cold Start**: ECS scale-from-zero adds latency

---

## Rollback Plan

If DeepSeek extraction quality is insufficient:

1. Keep Textract Lambdas deployed (commented out in Step Function)
2. Feature flag allows instant rollback
3. Both systems write same output format

---

## Files to Modify

| File | Action |
|------|--------|
| `infrastructure/lib/deepseek-ecs-stack.ts` | **NEW** - ECS infrastructure |
| `infrastructure/lambda/document-pipeline-steps/extract-text-deepseek.ts` | **NEW** - Extraction Lambda |
| `infrastructure/lib/document-pipeline-step-function.ts` | MODIFY - Replace Textract states |
| `infrastructure/lib/question-pipeline-step-function.ts` | MODIFY - Replace Textract states |
| `infrastructure/lib/api-stack.ts` | MODIFY - Add DeepSeek endpoint config |
| `infrastructure/lambda/helpers/textract.ts` | DEPRECATE |
| `infrastructure/lambda/document-pipeline-steps/textract-callback.ts` | DELETE |
| `infrastructure/lambda/question-pipeline/start-question-textract.ts` | DELETE |
| `infrastructure/lambda/question-pipeline/textract-question-callback.ts` | DELETE |

---

## Success Metrics

| Metric | Current (Textract) | Target (DeepSeek) |
|--------|-------------------|-------------------|
| Extraction Success Rate | 95% | >98% |
| Avg Processing Time | 45s | <60s |
| Task Timeout Errors | 54/month | 0 |
| Cost per 10K pages | $150 | <$200 |
| Table Extraction Quality | 70% | >90% |

---

## Open Questions

1. **Model Selection**: DeepSeek-VL vs DeepSeek-V2 vs custom fine-tune?
2. **GPU vs CPU**: GPU instances for faster inference worth the cost?
3. **Batch Processing**: Process multiple pages in parallel?
4. **Caching**: Cache extracted text for re-processing?

---

## Next Steps

1. [ ] Set up DeepSeek container in development
2. [ ] Benchmark extraction quality on sample RFPs
3. [ ] Define API contract for extraction service
4. [ ] Create CDK stack for ECS deployment
5. [ ] Implement feature flag for gradual rollout
