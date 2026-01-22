/*
#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { StorageStack } from '../lib/storage-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/fe-stack';
import { CiStack } from '../lib/ci-stack';

const app = new cdk.App();

const stage = 'dev';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '018222125196', // Hardcode the account ID we obtained
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// DEV auth stack
const auth = new AuthStack(app, 'AutoRfp-Auth-Dev', {
  env,
  stage: stage,
  domainPrefixBase: 'auto-rfp',
  callbackUrl: 'http://localhost:3000',
});

const network = new NetworkStack(app, 'AutoRfp-Network', { env });
const db = new DatabaseStack(app, 'AutoRfp-Database', {
  env,
  vpc: network.vpc,
  dbSecurityGroup: network.dbSecurityGroup,
});

const storage = new StorageStack(app, 'AutoRfp-Storage', { env });

const api = new ApiStack(app, 'AutoRfp-Api', {
  env,
  stage,
  documentsBucket: storage.documentsBucket,
  dbSecret: db.dbSecret,
  database: db.database,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});

const frontend = new FrontendStack(app, 'AutoRfp-Frontend', {
  env,
  websiteBucket: storage.websiteBucket,
  api: api.api,
});

new CiStack(app, 'AutoRfp-Ci', {
  env,
  websiteBucket: storage.websiteBucket,
  documentsBucket: storage.documentsBucket,
  distribution: frontend.distribution,
});*/
