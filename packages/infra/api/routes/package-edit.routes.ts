import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function packageEditDomain(): DomainRoutes {
  return {
    basePath: 'package-edit',
    routes: [
      // Synchronous intent-routing chat (fast model, bounded tool rounds → <29s).
      {
        method: 'POST',
        path: 'chat',
        entry: lambdaEntry('package-edit/chat.ts'),
        timeoutSeconds: 60,
        memorySize: 512,
      },
      // Poll the latest proposal run + proposals + staleness.
      {
        method: 'GET',
        path: 'run',
        entry: lambdaEntry('package-edit/get-run.ts'),
      },
      // Apply confirmed edits (sync, no LLM, guarded per-target writes).
      // NOTE: HTTP API v2 caps the integration timeout at ~30s, so a very large
      // apply batch can 504 the CLIENT even though this Lambda (60s) keeps writing.
      // That's safe to retry: apply is per-target and guarded — each edit re-verifies
      // its `before` before writing, so an already-applied edit is skipped-stale on
      // retry (never double-applied), and appliedEditIds are persisted so re-polling
      // surfaces only what's left. Kept at 60s so in-flight writes complete rather
      // than aborting mid-batch; the client should retry on a 504.
      {
        method: 'POST',
        path: 'apply',
        entry: lambdaEntry('package-edit/apply-edits.ts'),
        timeoutSeconds: 60,
        memorySize: 512,
      },
    ],
  };
}
