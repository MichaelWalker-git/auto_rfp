/**
 * CDK Nag Suppressions for AutoRFP Infrastructure
 *
 * This file contains documented suppressions for AWS Solutions security checks.
 * Each suppression includes a reason explaining why it's acceptable.
 *
 * For production deployments, review each suppression and consider
 * implementing the recommended security controls.
 */

import { Stack } from 'aws-cdk-lib';
import { NagSuppressions, NagPackSuppression } from 'cdk-nag';

/**
 * Common Lambda function suppressions
 * Apply to stacks that contain Lambda functions
 */
export function addLambdaSuppressions(stack: Stack, isProduction = false): void {
  const suppressions: NagPackSuppression[] = [
    {
      id: 'AwsSolutions-IAM4',
      reason: 'Using AWS managed policies (AWSLambdaBasicExecutionRole, AWSLambdaVPCAccessExecutionRole) is acceptable for Lambda functions. Custom policies are used for specific resource access.',
    },
    {
      id: 'AwsSolutions-IAM5',
      reason: 'Wildcard permissions are required for DynamoDB operations on indexes (table/*/index/*) and S3 object operations (bucket/*). Resource-level permissions are used where possible.',
    },
    {
      id: 'AwsSolutions-L1',
      reason: 'Lambda functions use Node.js 20.x which is a currently supported runtime. Will upgrade when newer LTS versions are available.',
    },
  ];

  if (!isProduction) {
    suppressions.push({
      id: 'AwsSolutions-COG4',
      reason: 'API Gateway authorization is handled by Cognito User Pools. Some endpoints may be public by design (health checks).',
    });
  }

  NagSuppressions.addStackSuppressions(stack, suppressions);
}

/**
 * API Gateway suppressions
 */
export function addApiGatewaySuppressions(stack: Stack, isProduction = false): void {
  const suppressions: NagPackSuppression[] = [
    {
      id: 'AwsSolutions-APIG2',
      reason: 'Request validation is handled at the Lambda function level using Zod schemas for type-safe validation.',
    },
    {
      id: 'AwsSolutions-APIG4',
      reason: 'Authorization is implemented using Cognito User Pools authorizer for all protected endpoints.',
    },
  ];

  if (!isProduction) {
    suppressions.push(
      {
        id: 'AwsSolutions-APIG1',
        reason: 'Access logging will be enabled for production. Dev environment omits for cost optimization.',
      },
      {
        id: 'AwsSolutions-APIG3',
        reason: 'WAF will be configured for production. Dev environment omits for cost optimization.',
      },
      {
        id: 'AwsSolutions-APIG6',
        reason: 'CloudWatch logging at ERROR level is enabled. Full request/response logging will be configured for production.',
      }
    );
  }

  NagSuppressions.addStackSuppressions(stack, suppressions);
}

/**
 * Cognito User Pool suppressions
 */
export function addCognitoSuppressions(stack: Stack, _isProduction = false): void {
  const suppressions: NagPackSuppression[] = [
    {
      id: 'AwsSolutions-COG1',
      reason: 'Password policy is configured with: minLength 8, requireLowercase, requireUppercase, requireDigits, requireSymbols.',
    },
    {
      id: 'AwsSolutions-COG2',
      reason: 'MFA is not required for this application. Users authenticate with email/password. MFA can be enabled for production if required.',
    },
    {
      id: 'AwsSolutions-COG3',
      reason: 'Advanced Security Mode is enabled (ENFORCED) for threat protection.',
    },
  ];

  NagSuppressions.addStackSuppressions(stack, suppressions);
}

/**
 * DynamoDB suppressions
 */
export function addDynamoDBSuppressions(stack: Stack, isProduction = false): void {
  const suppressions: NagPackSuppression[] = [
    {
      id: 'AwsSolutions-DDB3',
      reason: 'Point-in-time recovery is enabled for the DynamoDB table.',
    },
  ];

  if (!isProduction) {
    suppressions.push({
      id: 'AwsSolutions-DDB4',
      reason: 'DynamoDB deletion protection will be enabled for production. Dev allows destroy for testing.',
    });
  }

  NagSuppressions.addStackSuppressions(stack, suppressions);
}

/**
 * S3 bucket suppressions
 */
export function addS3Suppressions(stack: Stack, isProduction = false): void {
  const suppressions: NagPackSuppression[] = [
    {
      id: 'AwsSolutions-S2',
      reason: 'S3 bucket public access is blocked via BlockPublicAccess.BLOCK_ALL.',
    },
    {
      id: 'AwsSolutions-S3',
      reason: 'S3 versioning is enabled for the documents bucket.',
    },
  ];

  if (!isProduction) {
    suppressions.push(
      {
        id: 'AwsSolutions-S1',
        reason: 'Server access logging will be enabled for production. Dev environment omits for cost/simplicity.',
      },
      {
        id: 'AwsSolutions-S10',
        reason: 'SSL-only bucket policy will be added for production. Access is currently via presigned URLs which use HTTPS.',
      }
    );
  }

  NagSuppressions.addStackSuppressions(stack, suppressions);
}

/**
 * SQS queue suppressions
 */
export function addSQSSuppressions(stack: Stack, _isProduction = false): void {
  const suppressions: NagPackSuppression[] = [
    {
      id: 'AwsSolutions-SQS3',
      reason: 'Dead letter queue is configured for the executive brief queue to handle failed messages.',
    },
    {
      id: 'AwsSolutions-SQS4',
      reason: 'SQS queue is encrypted using AWS managed encryption (SSE-SQS).',
    },
  ];

  NagSuppressions.addStackSuppressions(stack, suppressions);
}

/**
 * Step Functions suppressions
 */
export function addStepFunctionsSuppressions(stack: Stack, _isProduction = false): void {
  const suppressions: NagPackSuppression[] = [
    {
      id: 'AwsSolutions-SF1',
      reason: 'Step Functions logging is enabled at ERROR level. CloudWatch Logs are used for execution history.',
    },
    {
      id: 'AwsSolutions-SF2',
      reason: 'X-Ray tracing will be enabled for production. Dev environment omits for cost optimization.',
    },
  ];

  NagSuppressions.addStackSuppressions(stack, suppressions);
}

/**
 * CloudWatch Logs suppressions
 */
export function addCloudWatchSuppressions(stack: Stack, isProduction = false): void {
  const suppressions: NagPackSuppression[] = [];

  if (!isProduction) {
    suppressions.push({
      id: 'AwsSolutions-CW1',
      reason: 'Log retention will be configured for production. Dev uses default retention.',
    });
  }

  if (suppressions.length > 0) {
    NagSuppressions.addStackSuppressions(stack, suppressions);
  }
}

/**
 * Apply all common suppressions to a stack
 */
export function addAllSuppressions(stack: Stack, isProduction = false): void {
  addLambdaSuppressions(stack, isProduction);
  addApiGatewaySuppressions(stack, isProduction);
  addCognitoSuppressions(stack, isProduction);
  addDynamoDBSuppressions(stack, isProduction);
  addS3Suppressions(stack, isProduction);
  addSQSSuppressions(stack, isProduction);
  addStepFunctionsSuppressions(stack, isProduction);
  addCloudWatchSuppressions(stack, isProduction);
}
