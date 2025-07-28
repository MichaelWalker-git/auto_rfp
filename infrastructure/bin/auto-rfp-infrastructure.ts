#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AutoRfpInfrastructureStack } from '../lib/auto-rfp-infrastructure-stack';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();

// Get environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '018222125196', // Hardcode the account ID we obtained
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Create the main infrastructure stack
const stack = new AutoRfpInfrastructureStack(app, 'AutoRfpInfrastructureStack', {
  env,
  description: 'AutoRFP Infrastructure - RDS, Cognito, S3, SES with AWS Well-Architected Framework Compliance',
  tags: {
    Project: 'AutoRFP',
    Environment: 'Production',
    ManagedBy: 'CDK',
    SecurityCompliance: 'AWS-Solutions-Checks',
  },
});

// Add CDK NAG AWS Solutions Checks for security compliance
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Output CDK NAG information
console.log('🔒 CDK NAG AWS Solutions Checks enabled for security compliance');
console.log('📋 This will validate infrastructure against AWS Well-Architected Framework');
console.log('⚠️  Any security issues will be reported during synthesis');
