import type { DomainRoutes } from './types';
export function proposalDomain(): DomainRoutes {
  return { basePath: 'proposal', routes: [
    { method: 'POST', path: 'generate-proposal', entry: 'lambda/proposal/generate-proposal.ts' },
    { method: 'GET', path: 'get-proposals', entry: 'lambda/proposal/get-proposals.ts' },
    { method: 'GET', path: 'get-proposal', entry: 'lambda/proposal/get-proposal.ts' },
    { method: 'POST', path: 'save-proposal', entry: 'lambda/proposal/save-proposal.ts' },
  ]};
}
