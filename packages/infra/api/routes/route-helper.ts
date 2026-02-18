import * as path from 'path';

/**
 * Helper to generate the correct Lambda entry path from route files.
 * Routes are defined in packages/infra/api/routes/
 * Lambda handlers are in apps/functions/src/handlers/
 * 
 * @param handlerPath - Path relative to apps/functions/src/handlers/ (e.g., 'organization/get-organizations.ts')
 * @returns Absolute path to the Lambda handler
 */
export function lambdaEntry(handlerPath: string): string {
  // From packages/infra/api/routes/ to apps/functions/src/handlers/
  // Go up 4 levels: routes -> api -> infra -> packages -> root
  // Then down: apps -> functions -> src -> handlers
  return path.join(__dirname, '../../../../apps/functions/src/handlers', handlerPath);
}
