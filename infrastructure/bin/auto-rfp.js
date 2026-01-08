"use strict";
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0by1yZnAuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhdXRvLXJmcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7S0EwREsiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEF1dGhTdGFjayB9IGZyb20gJy4uL2xpYi9hdXRoLXN0YWNrJztcbmltcG9ydCB7IE5ldHdvcmtTdGFjayB9IGZyb20gJy4uL2xpYi9uZXR3b3JrLXN0YWNrJztcbmltcG9ydCB7IERhdGFiYXNlU3RhY2sgfSBmcm9tICcuLi9saWIvZGF0YWJhc2Utc3RhY2snO1xuaW1wb3J0IHsgU3RvcmFnZVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0b3JhZ2Utc3RhY2snO1xuaW1wb3J0IHsgQXBpU3RhY2sgfSBmcm9tICcuLi9saWIvYXBpLXN0YWNrJztcbmltcG9ydCB7IEZyb250ZW5kU3RhY2sgfSBmcm9tICcuLi9saWIvZmUtc3RhY2snO1xuaW1wb3J0IHsgQ2lTdGFjayB9IGZyb20gJy4uL2xpYi9jaS1zdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbmNvbnN0IHN0YWdlID0gJ2Rldic7XG5cbmNvbnN0IGVudiA9IHtcbiAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCB8fCAnMDE4MjIyMTI1MTk2JywgLy8gSGFyZGNvZGUgdGhlIGFjY291bnQgSUQgd2Ugb2J0YWluZWRcbiAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gfHwgJ3VzLWVhc3QtMScsXG59O1xuXG4vLyBERVYgYXV0aCBzdGFja1xuY29uc3QgYXV0aCA9IG5ldyBBdXRoU3RhY2soYXBwLCAnQXV0b1JmcC1BdXRoLURldicsIHtcbiAgZW52LFxuICBzdGFnZTogc3RhZ2UsXG4gIGRvbWFpblByZWZpeEJhc2U6ICdhdXRvLXJmcCcsXG4gIGNhbGxiYWNrVXJsOiAnaHR0cDovL2xvY2FsaG9zdDozMDAwJyxcbn0pO1xuXG5jb25zdCBuZXR3b3JrID0gbmV3IE5ldHdvcmtTdGFjayhhcHAsICdBdXRvUmZwLU5ldHdvcmsnLCB7IGVudiB9KTtcbmNvbnN0IGRiID0gbmV3IERhdGFiYXNlU3RhY2soYXBwLCAnQXV0b1JmcC1EYXRhYmFzZScsIHtcbiAgZW52LFxuICB2cGM6IG5ldHdvcmsudnBjLFxuICBkYlNlY3VyaXR5R3JvdXA6IG5ldHdvcmsuZGJTZWN1cml0eUdyb3VwLFxufSk7XG5cbmNvbnN0IHN0b3JhZ2UgPSBuZXcgU3RvcmFnZVN0YWNrKGFwcCwgJ0F1dG9SZnAtU3RvcmFnZScsIHsgZW52IH0pO1xuXG5jb25zdCBhcGkgPSBuZXcgQXBpU3RhY2soYXBwLCAnQXV0b1JmcC1BcGknLCB7XG4gIGVudixcbiAgc3RhZ2UsXG4gIGRvY3VtZW50c0J1Y2tldDogc3RvcmFnZS5kb2N1bWVudHNCdWNrZXQsXG4gIGRiU2VjcmV0OiBkYi5kYlNlY3JldCxcbiAgZGF0YWJhc2U6IGRiLmRhdGFiYXNlLFxuICB1c2VyUG9vbDogYXV0aC51c2VyUG9vbCxcbiAgdXNlclBvb2xDbGllbnQ6IGF1dGgudXNlclBvb2xDbGllbnQsXG59KTtcblxuY29uc3QgZnJvbnRlbmQgPSBuZXcgRnJvbnRlbmRTdGFjayhhcHAsICdBdXRvUmZwLUZyb250ZW5kJywge1xuICBlbnYsXG4gIHdlYnNpdGVCdWNrZXQ6IHN0b3JhZ2Uud2Vic2l0ZUJ1Y2tldCxcbiAgYXBpOiBhcGkuYXBpLFxufSk7XG5cbm5ldyBDaVN0YWNrKGFwcCwgJ0F1dG9SZnAtQ2knLCB7XG4gIGVudixcbiAgd2Vic2l0ZUJ1Y2tldDogc3RvcmFnZS53ZWJzaXRlQnVja2V0LFxuICBkb2N1bWVudHNCdWNrZXQ6IHN0b3JhZ2UuZG9jdW1lbnRzQnVja2V0LFxuICBkaXN0cmlidXRpb246IGZyb250ZW5kLmRpc3RyaWJ1dGlvbixcbn0pOyovXG4iXX0=