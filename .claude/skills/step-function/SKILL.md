---
name: step-function
description: Create AWS Step Functions pipelines with CDK for document processing, answer generation, and async workflows
---

# Step Function Pipeline Creation

When creating a new Step Functions pipeline in this project, follow these exact steps:

## 1. Pipeline Architecture

Step Functions are used for multi-step async workflows:
- **Document Processing**: Upload → Textract → Chunking → Embedding → Index
- **Answer Generation**: Prepare Questions → Batch Process → Generate Answers
- **Question Extraction**: Upload → Textract → AI Analysis → Store Questions

## 2. CDK Definition

Create `packages/infra/<pipeline-name>-step-function.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface <Pipeline>StepFunctionProps {
  stage: string;
  table: cdk.aws_dynamodb.ITable;
  bucket: cdk.aws_s3.IBucket;
  // ... other shared resources
}

export const create<Pipeline>StepFunction = (
  scope: Construct,
  props: <Pipeline>StepFunctionProps,
): sfn.StateMachine => {
  const { stage, table, bucket } = props;

  // Step 1: Invoke Lambda
  const step1 = new tasks.LambdaInvoke(scope, 'Step1Name', {
    lambdaFunction: step1Lambda,
    outputPath: '$.Payload',
    retryOnServiceExceptions: true,
  });

  // Step 2: Choice state
  const isComplete = new sfn.Choice(scope, 'IsComplete?')
    .when(sfn.Condition.stringEquals('$.status', 'COMPLETE'), successState)
    .otherwise(step3);

  // Build chain
  const definition = step1
    .next(isComplete);

  return new sfn.StateMachine(scope, `${stage}-<Pipeline>Pipeline`, {
    definitionBody: sfn.DefinitionBody.fromChainable(definition),
    timeout: cdk.Duration.minutes(30),
    tracingEnabled: false,  // Cost optimization: no X-Ray
  });
};
```

## 3. Lambda Step Handlers

Each step in the pipeline is a Lambda handler in `apps/functions/src/handlers/<pipeline>/`:

```typescript
import type { Context } from 'aws-lambda';

interface StepInput {
  orgId: string;
  projectId: string;
  // ... step-specific fields
}

interface StepOutput {
  status: 'CONTINUE' | 'COMPLETE' | 'FAILED';
  // ... output fields
}

export const handler = async (event: StepInput, _context: Context): Promise<StepOutput> => {
  // Step Functions handlers receive direct JSON input (not API Gateway events)
  // No middy middleware needed — these are internal invocations

  try {
    const result = await processStep(event);
    return { status: 'COMPLETE', ...result };
  } catch (error) {
    console.error('Step failed:', error);
    return { status: 'FAILED', error: (error as Error).message };
  }
};
```

## 4. Error Handling

```typescript
// Add retry and catch to steps
const step1 = new tasks.LambdaInvoke(scope, 'Step1', {
  lambdaFunction: fn,
  retryOnServiceExceptions: true,
}).addRetry({
  maxAttempts: 2,
  interval: cdk.Duration.seconds(5),
  backoffRate: 2,
}).addCatch(failureState, {
  resultPath: '$.error',
});
```

## 5. Hard Rules

- **Step Function handlers do NOT use middy** — they receive direct JSON, not API Gateway events
- **Use audit logging** in each step — `writeAuditLog` with `userId: 'system'`
- **Set reasonable timeouts** — 30 min max for pipelines, 5 min per step
- **No X-Ray tracing** — cost optimization
- **Error states must update DynamoDB** — mark entity status as FAILED
- **Use `outputPath: '$.Payload'`** — extract Lambda response from wrapper
- **Add retries** — at least 2 retries with exponential backoff for transient failures
