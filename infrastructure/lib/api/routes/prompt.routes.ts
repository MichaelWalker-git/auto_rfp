import type { DomainRoutes } from './types';

export function promptDomain(): DomainRoutes {
  return {
    basePath: 'prompt',
    routes: [
      { method: 'POST', path: 'save-prompt/{scope}', entry: 'lambda/prompt/save-prompt.ts' },
      { method: 'GET', path: 'get-prompts', entry: 'lambda/prompt/get-prompts.ts' },
    ],
  };
}
