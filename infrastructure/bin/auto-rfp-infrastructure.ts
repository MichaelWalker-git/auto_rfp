#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AutoRfpInfrastructureStack } from '../lib/auto-rfp-infrastructure-stack';

const app = new cdk.App();

// Get environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '018222125196', // Hardcode the account ID we obtained
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Create the main infrastructure stack
new AutoRfpInfrastructureStack(app, 'AutoRfpInfrastructureStack', {
  env,
  description: 'AutoRFP Infrastructure - RDS, Cognito, S3, SES',
  tags: {
    Project: 'AutoRFP',
    Environment: 'Production',
    ManagedBy: 'CDK',
  },
});
