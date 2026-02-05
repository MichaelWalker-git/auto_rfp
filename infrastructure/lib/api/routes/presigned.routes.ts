import type { DomainRoutes } from './types';
export function presignedDomain(): DomainRoutes {
  return { basePath: 'presigned', routes: [
    { method: 'POST', path: 'presigned-url', entry: 'lambda/presigned/generate-presigned-url.ts' },
  ]};
}
