import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function presignedDomain(): DomainRoutes {
  return { basePath: 'presigned', routes: [
    { method: 'POST', path: 'presigned-url', entry: lambdaEntry('presigned/generate-presigned-url.ts') },
  ]};
}
