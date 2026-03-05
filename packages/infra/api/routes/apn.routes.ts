import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const apnDomain = (): DomainRoutes => ({
  basePath: 'apn',
  routes: [
    {
      method:  'GET',
      path:    'credentials',
      entry:   lambdaEntry('apn/get-apn-credentials.ts'),
    },
    {
      method:  'POST',
      path:    'credentials',
      entry:   lambdaEntry('apn/save-apn-credentials.ts'),
    },
    {
      method:  'GET',
      path:    'registration',
      entry:   lambdaEntry('apn/get-apn-registration.ts'),
    },
    {
      method:  'POST',
      path:    'retry-registration',
      entry:   lambdaEntry('apn/retry-apn-registration.ts'),
      nodeModules: ['@smithy/signature-v4', '@smithy/protocol-http', '@aws-crypto/sha256-js'],
    },
    {
      method:  'GET',
      path:    'registrations',
      entry:   lambdaEntry('apn/list-apn-registrations.ts'),
    },
  ],
});
